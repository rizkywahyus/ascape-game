package dev.ascape.net;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import dev.ascape.net.protocol.ProtocolCodec;
import dev.ascape.net.protocol.ServerMessages;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/** A client that stops reading must be dropped without ever blocking the (room) thread that sends to it. */
class ClientConnectionBackpressureTest {

	@Test
	void slowConsumerIsDisconnectedAndSendNeverBlocks() throws Exception {
		WebSocketSession session = mock(WebSocketSession.class);
		when(session.getId()).thenReturn("slow");
		when(session.isOpen()).thenReturn(true);
		CountDownLatch neverReleased = new CountDownLatch(1);
		doAnswer(invocation -> {
			neverReleased.await(); // the socket never drains
			return null;
		}).when(session).sendMessage(any());

		ClientConnection connection = new ClientConnection(session, PlayerIdentity.guest("slow"),
				new ProtocolCodec(JsonMapper.builder().build()), bytes -> {
				}, 0, new RateLimiter(60, 120, System::nanoTime));

		long start = System.nanoTime();
		for (int i = 0; i < 1_000; i++) {
			connection.send(new ServerMessages.Pong(i, i));
		}
		long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

		assertThat(elapsedMillis).as("send() only enqueues").isLessThan(500);
		verify(session, timeout(2_000)).close(argThat((CloseStatus status) ->
				status.getCode() == CloseStatus.SESSION_NOT_RELIABLE.getCode()));
		neverReleased.countDown();
	}
}
