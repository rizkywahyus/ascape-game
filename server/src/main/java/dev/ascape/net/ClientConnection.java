package dev.ascape.net;

import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntConsumer;

import dev.ascape.game.room.GameRoom;
import dev.ascape.net.protocol.ProtocolCodec;
import dev.ascape.net.protocol.ServerMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * One connected client. Outbound messages go through a bounded outbox drained by a dedicated virtual thread,
 * so a room thread never blocks on a slow socket; a client that lets the outbox fill up is disconnected.
 * With simulated latency enabled, inbound work is delayed on a second virtual thread (order preserved).
 */
public final class ClientConnection {

	private static final Logger log = LoggerFactory.getLogger(ClientConnection.class);
	private static final int OUTBOX_CAPACITY = 256;
	private static final int INBOX_CAPACITY = 256;
	private static final CloseStatus SLOW_CONSUMER = CloseStatus.SESSION_NOT_RELIABLE.withReason("slow consumer");

	private record Delayed<T>(T item, long dueNanos) {
	}

	private final WebSocketSession session;
	private final PlayerIdentity identity;
	private final ProtocolCodec codec;
	private final IntConsumer bytesSentListener;
	private final long latencyNanos;
	private final BlockingQueue<Delayed<ServerMessage>> outbox = new ArrayBlockingQueue<>(OUTBOX_CAPACITY);
	private final BlockingQueue<Delayed<Runnable>> inbox = new ArrayBlockingQueue<>(INBOX_CAPACITY);
	private final Thread sender;
	private final Thread receiver;
	private final RateLimiter rateLimiter;
	private final AtomicInteger droppedMessages = new AtomicInteger();
	private final AtomicBoolean closed = new AtomicBoolean();
	private volatile GameRoom room;

	public ClientConnection(WebSocketSession session, PlayerIdentity identity, ProtocolCodec codec,
			IntConsumer bytesSentListener, int simulatedLatencyMs, RateLimiter rateLimiter) {
		this.session = session;
		this.rateLimiter = rateLimiter;
		this.identity = identity;
		this.codec = codec;
		this.bytesSentListener = bytesSentListener;
		this.latencyNanos = TimeUnit.MILLISECONDS.toNanos(simulatedLatencyMs);
		this.sender = Thread.ofVirtual().name("ws-send-" + session.getId()).start(this::drainOutbox);
		this.receiver = latencyNanos > 0
				? Thread.ofVirtual().name("ws-recv-" + session.getId()).start(this::drainInbox)
				: null;
	}

	public String playerId() {
		return identity.playerId();
	}

	public String displayName() {
		return identity.displayName();
	}

	public PlayerIdentity identity() {
		return identity;
	}

	RateLimiter rateLimiter() {
		return rateLimiter;
	}

	/** Returns the number of messages dropped so far, including this one. */
	int recordDroppedMessage() {
		return droppedMessages.incrementAndGet();
	}

	int droppedMessages() {
		return droppedMessages.get();
	}

	public GameRoom room() {
		return room;
	}

	public void setRoom(GameRoom room) {
		this.room = room;
	}

	/** Queues a message; never blocks. Messages to a closed connection are dropped. */
	public void send(ServerMessage message) {
		if (closed.get()) {
			return;
		}
		if (!outbox.offer(new Delayed<>(message, System.nanoTime() + latencyNanos))) {
			log.warn("Outbox full for player {}, disconnecting", playerId());
			close(SLOW_CONSUMER);
		}
	}

	/** Runs inbound handling now, or after the simulated latency. */
	void receive(Runnable handling) {
		if (receiver == null) {
			handling.run();
			return;
		}
		if (!inbox.offer(new Delayed<>(handling, System.nanoTime() + latencyNanos))) {
			log.warn("Inbox full for player {}, disconnecting", playerId());
			close(CloseStatus.POLICY_VIOLATION);
		}
	}

	/** Closes the socket once; later calls do nothing. */
	public void close(CloseStatus status) {
		if (!closed.compareAndSet(false, true)) {
			return;
		}
		shutdown();
		if (!session.isOpen()) {
			return;
		}
		// Closing may block on I/O; keep it off the caller's (possibly room) thread.
		Thread.ofVirtual().start(() -> {
			try {
				session.close(status);
			}
			catch (IOException e) {
				log.debug("Error closing session {}", session.getId(), e);
			}
		});
	}

	/** Stops the worker threads after the socket is gone. */
	void shutdown() {
		sender.interrupt();
		if (receiver != null) {
			receiver.interrupt();
		}
	}

	private void drainOutbox() {
		try {
			while (!Thread.currentThread().isInterrupted()) {
				Delayed<ServerMessage> next = outbox.take();
				waitUntil(next.dueNanos());
				TextMessage message = new TextMessage(codec.encode(next.item()));
				session.sendMessage(message);
				bytesSentListener.accept(message.getPayloadLength());
			}
		}
		catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
		catch (IOException | IllegalStateException e) {
			log.debug("Send failed for player {}, closing", playerId(), e);
			close(CloseStatus.SERVER_ERROR);
		}
	}

	private void drainInbox() {
		try {
			while (!Thread.currentThread().isInterrupted()) {
				Delayed<Runnable> next = inbox.take();
				waitUntil(next.dueNanos());
				next.item().run();
			}
		}
		catch (InterruptedException e) {
			Thread.currentThread().interrupt();
		}
	}

	private static void waitUntil(long dueNanos) throws InterruptedException {
		long remaining = dueNanos - System.nanoTime();
		if (remaining > 0) {
			TimeUnit.NANOSECONDS.sleep(remaining);
		}
	}
}
