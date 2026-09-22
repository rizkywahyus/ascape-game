package dev.ascape.net;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import dev.ascape.config.AscapeProperties;
import dev.ascape.game.room.GameRoom;
import dev.ascape.game.room.RolePreference;
import dev.ascape.game.room.RoomManager;
import dev.ascape.net.protocol.ClientMessages.ChatSend;
import dev.ascape.net.protocol.ClientMessages.ClientMessage;
import dev.ascape.net.protocol.ClientMessages.Hold;
import dev.ascape.net.protocol.ClientMessages.Input;
import dev.ascape.net.protocol.ClientMessages.Join;
import dev.ascape.net.protocol.ClientMessages.Leave;
import dev.ascape.net.protocol.ClientMessages.Ping;
import dev.ascape.net.protocol.ClientMessages.Queue;
import dev.ascape.net.protocol.ProtocolCodec;
import dev.ascape.net.protocol.ProtocolException;
import dev.ascape.net.protocol.ServerMessages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/** Decodes client messages and routes them to rooms; never touches world state directly. */
@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

	/** Session attribute set during the handshake (see {@link PlayerIdentity}). */
	public static final String IDENTITY_ATTRIBUTE = "ascape.identity";

	private static final Logger log = LoggerFactory.getLogger(GameWebSocketHandler.class);
	private static final int MAX_CHAT_LENGTH = 200;
	private static final double MESSAGES_PER_SECOND = 60;
	private static final double MESSAGE_BURST = 120;
	/** Dropped messages tolerated before a flooding client is disconnected. */
	private static final int MAX_DROPPED_MESSAGES = 300;
	private static final CloseStatus FLOODING = CloseStatus.POLICY_VIOLATION.withReason("rate limit");

	private final RoomManager roomManager;
	private final ProtocolCodec codec;
	private final int simulatedLatencyMs;
	private final Map<String, ClientConnection> connectionsBySessionId = new ConcurrentHashMap<>();

	public GameWebSocketHandler(RoomManager roomManager, ProtocolCodec codec, AscapeProperties properties) {
		this.roomManager = roomManager;
		this.codec = codec;
		this.simulatedLatencyMs = properties.debug().simulatedLatencyMs();
		if (simulatedLatencyMs > 0) {
			log.warn("Simulated latency enabled: {} ms each way", simulatedLatencyMs);
		}
	}

	@Override
	public void afterConnectionEstablished(WebSocketSession session) {
		PlayerIdentity identity = (PlayerIdentity) session.getAttributes().get(IDENTITY_ATTRIBUTE);
		if (identity == null) {
			identity = PlayerIdentity.guest(session.getId());
		}
		ClientConnection connection = new ClientConnection(session, identity, codec,
				roomManager.metrics()::recordBytesSent, simulatedLatencyMs,
				new RateLimiter(MESSAGES_PER_SECOND, MESSAGE_BURST, System::nanoTime));
		connectionsBySessionId.put(session.getId(), connection);
		log.debug("Connected {} as {}", session.getId(), identity.playerId());
	}

	@Override
	protected void handleTextMessage(WebSocketSession session, TextMessage message) {
		ClientConnection connection = connectionsBySessionId.get(session.getId());
		if (connection == null) {
			return;
		}
		if (!connection.rateLimiter().tryAcquire()) {
			if (connection.recordDroppedMessage() == 1) {
				connection.send(new ServerMessages.Error("rate_limited", "Too many messages; some were dropped"));
			}
			if (connection.droppedMessages() > MAX_DROPPED_MESSAGES) {
				log.warn("Disconnecting {} for flooding", connection.playerId());
				connection.close(FLOODING);
			}
			return;
		}
		String payload = message.getPayload();
		connection.receive(() -> {
			try {
				dispatch(connection, codec.decode(payload));
			}
			catch (ProtocolException e) {
				connection.send(new ServerMessages.Error(e.code(), e.getMessage()));
			}
		});
	}

	private void dispatch(ClientConnection connection, ClientMessage message) {
		switch (message) {
			case Ping ping -> connection.send(new ServerMessages.Pong(ping.ts(), System.currentTimeMillis()));
			case Queue queue -> roomManager.queue(connection, rolePreference(queue.rolePref()));
			case Join join -> {
				if (!RoomManager.isValidRoomId(join.roomId())) {
					throw new ProtocolException("bad_room_id", "roomId must match [a-z0-9-]{1,32}");
				}
				roomManager.join(connection, join.roomId(), rolePreference(join.rolePref()));
			}
			case Leave leave -> roomManager.leave(connection);
			case Hold hold -> requireRoom(connection).submitHold(connection, hold.hold());
			case Input input -> {
				if (input.seq() <= 0) {
					throw new ProtocolException("bad_message", "seq must be positive");
				}
				requireRoom(connection).submitInput(connection, input);
			}
			case ChatSend chat -> {
				String text = chat.text() == null ? "" : chat.text().strip();
				if (text.isEmpty() || text.length() > MAX_CHAT_LENGTH) {
					throw new ProtocolException("bad_message", "chat text must be 1-" + MAX_CHAT_LENGTH + " characters");
				}
				requireRoom(connection).submitChat(connection, text);
			}
		}
	}

	private static RolePreference rolePreference(String value) {
		return RolePreference.parse(value)
				.orElseThrow(() -> new ProtocolException("bad_message", "rolePref must be monster, survivor or any"));
	}

	private static GameRoom requireRoom(ClientConnection connection) {
		GameRoom room = connection.room();
		if (room == null) {
			throw new ProtocolException("not_in_room", "Join a room first");
		}
		return room;
	}

	@Override
	public void handleTransportError(WebSocketSession session, Throwable exception) {
		log.debug("Transport error on {}", session.getId(), exception);
	}

	@Override
	public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
		ClientConnection connection = connectionsBySessionId.remove(session.getId());
		if (connection == null) {
			return;
		}
		connection.shutdown();
		GameRoom room = connection.room();
		if (room != null) {
			room.submitLeave(connection);
		}
		log.debug("Disconnected {} ({})", session.getId(), status);
	}
}
