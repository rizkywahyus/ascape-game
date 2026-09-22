package dev.ascape.net;

import java.net.URI;
import java.time.Duration;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/** Minimal protocol client for integration tests. */
final class TestGameClient implements AutoCloseable {

	private final BlockingQueue<JsonNode> received = new LinkedBlockingQueue<>();
	private final JsonMapper jsonMapper;
	private final WebSocketSession session;

	TestGameClient(URI uri, JsonMapper jsonMapper) throws Exception {
		this.jsonMapper = jsonMapper;
		this.session = new StandardWebSocketClient().execute(new TextWebSocketHandler() {
			@Override
			protected void handleTextMessage(WebSocketSession session, TextMessage message) {
				received.add(jsonMapper.readTree(message.getPayload()));
			}
		}, null, uri).get(5, TimeUnit.SECONDS);
	}

	void send(String type, Object payload) throws Exception {
		session.sendMessage(new TextMessage(jsonMapper.writeValueAsString(java.util.Map.of("t", type, "d", payload))));
	}

	void sendRaw(String text) throws Exception {
		session.sendMessage(new TextMessage(text));
	}

	/** Waits for the first message of {@code type} matching {@code condition}, discarding others. */
	JsonNode await(String type, Predicate<JsonNode> condition, Duration timeout) throws InterruptedException {
		long deadline = System.nanoTime() + timeout.toNanos();
		while (true) {
			long remaining = deadline - System.nanoTime();
			JsonNode message = remaining > 0 ? received.poll(remaining, TimeUnit.NANOSECONDS) : null;
			if (message == null) {
				throw new AssertionError("Timed out waiting for '" + type + "'");
			}
			if (message.get("t").asString().equals(type) && condition.test(message.get("d"))) {
				return message.get("d");
			}
		}
	}

	JsonNode await(String type, Duration timeout) throws InterruptedException {
		return await(type, d -> true, timeout);
	}

	@Override
	public void close() throws Exception {
		session.close();
	}
}
