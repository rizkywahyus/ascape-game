package dev.ascape.net;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.Map;

import dev.ascape.auth.TestJwtConfig;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.api.Test;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestJwtConfig.class)
class GameWebSocketIntegrationTest {

	private static final Duration TIMEOUT = Duration.ofSeconds(5);

	@LocalServerPort
	int port;

	@Autowired
	JsonMapper jsonMapper;

	private TestGameClient connect() throws Exception {
		return new TestGameClient(URI.create("ws://localhost:" + port + "/ws"), jsonMapper);
	}

	private TestGameClient connectAs(UUID userId) throws Exception {
		return new TestGameClient(URI.create("ws://localhost:" + port + "/ws?token=" + TestJwtConfig.PREFIX + userId),
				jsonMapper);
	}

	@Test
	void disconnectedPlayerIsReplacedByABotAndCanReclaimTheirCharacter() throws Exception {
		UUID userId = UUID.randomUUID();
		String roomId;
		int entityId;
		try (TestGameClient player = connectAs(userId); TestGameClient teammate = connect()) {
			player.send("queue", Map.of("rolePref", "survivor"));
			roomId = player.await("welcome", TIMEOUT).get("roomId").asString();
			teammate.send("join", Map.of("roomId", roomId, "rolePref", "survivor"));
			entityId = player.await("match", TIMEOUT).get("entityId").asInt();
			teammate.await("match", TIMEOUT);

			player.close();
			JsonNode roster = teammate.await("match", m -> {
				for (JsonNode entry : m.get("roster")) {
					if (entry.get("entityId").asInt() == entityId && entry.get("isBot").asBoolean()) {
						return true;
					}
				}
				return false;
			}, TIMEOUT);
			assertThat(roster).as("a bot takes over the dropped character").isNotNull();

			try (TestGameClient returning = connectAs(userId)) {
				returning.send("queue", Map.of("rolePref", "any"));
				assertThat(returning.await("welcome", TIMEOUT).get("roomId").asString()).isEqualTo(roomId);
				JsonNode takeover = returning.await("takeover", TIMEOUT);
				assertThat(takeover.get("reason").asString()).isEqualTo("reconnected");
				assertThat(takeover.get("entityId").asInt()).isEqualTo(entityId);
			}
		}
	}

	@Test
	void joiningGoesThroughLobbyIntoAMatchWithBots() throws Exception {
		try (TestGameClient client = connect()) {
			client.send("join", Map.of("roomId", "lobby-test", "rolePref", "survivor"));

			JsonNode welcome = client.await("welcome", TIMEOUT);
			assertThat(welcome.get("roomId").asString()).isEqualTo("lobby-test");
			assertThat(welcome.get("tickRate").asInt()).isEqualTo(20);
			assertThat(welcome.get("map").get("rows").size()).isGreaterThan(0);
			client.await("lobby", TIMEOUT);

			JsonNode match = client.await("match", TIMEOUT);
			assertThat(match.get("role").asString()).isEqualTo("survivor");
			assertThat(match.get("roster").size()).isEqualTo(5); // 1 monster + 4 survivors, bots filling the rest
			int entityId = match.get("entityId").asInt();

			JsonNode snapshot = client.await("snapshot", TIMEOUT);
			assertThat(snapshot.get("you").get("id").asInt()).isEqualTo(entityId);
			assertThat(snapshot.get("generators").size()).isEqualTo(7);
		}
	}

	@Test
	void teammatesSeeEachOtherMove() throws Exception {
		try (TestGameClient mover = connect(); TestGameClient watcher = connect()) {
			mover.send("join", Map.of("roomId", "move-test", "rolePref", "survivor"));
			watcher.send("join", Map.of("roomId", "move-test", "rolePref", "survivor"));
			int moverId = mover.await("match", TIMEOUT).get("entityId").asInt();
			watcher.await("match", TIMEOUT);
			JsonNode start = mover.await("snapshot", TIMEOUT).get("you");

			// Walk up: survivor spawns sit in the bottom-left room, which has floor above them.
			for (int seq = 1; seq <= 10; seq++) {
				mover.send("input", Map.of("seq", seq, "dx", 0, "dy", -1, "sprint", false, "interact", false,
						"actions", List.of()));
			}

			JsonNode seen = watcher.await("snapshot", snapshot -> {
				for (JsonNode entity : snapshot.get("entities")) {
					if (entity.get("id").asInt() == moverId && entity.get("y").asInt() < start.get("y").asInt()) {
						return true;
					}
				}
				return false;
			}, TIMEOUT);
			assertThat(seen).isNotNull();

			JsonNode acked = mover.await("snapshot", s -> s.get("ackSeq").asLong() == 10, TIMEOUT);
			assertThat(acked.get("you").get("y").asInt()).isLessThan(start.get("y").asInt());
		}
	}

	@Test
	void queueMatchmakesIntoTheSameRoomAndDropsInOverBots() throws Exception {
		try (TestGameClient first = connect(); TestGameClient second = connect()) {
			first.send("queue", Map.of("rolePref", "survivor"));
			String roomId = first.await("welcome", TIMEOUT).get("roomId").asString();
			first.await("match", TIMEOUT);

			// The match is running with bot survivors, so the next survivor drops in over one of them.
			second.send("queue", Map.of("rolePref", "survivor"));
			assertThat(second.await("welcome", TIMEOUT).get("roomId").asString()).isEqualTo(roomId);
			JsonNode takeover = second.await("takeover", TIMEOUT);
			assertThat(takeover.get("reason").asString()).isEqualTo("took over a bot");
			assertThat(second.await("match", TIMEOUT).get("role").asString()).isEqualTo("survivor");
		}
	}

	@Test
	void rejectsInputBeforeJoinAndGarbage() throws Exception {
		try (TestGameClient client = connect()) {
			client.send("input", Map.of("seq", 1, "dx", 1, "dy", 0, "sprint", false, "interact", false,
					"actions", List.of()));
			assertThat(client.await("error", TIMEOUT).get("code").asString()).isEqualTo("not_in_room");

			client.sendRaw("not json");
			assertThat(client.await("error", TIMEOUT).get("code").asString()).isEqualTo("bad_message");

			client.send("teleport", Map.of());
			assertThat(client.await("error", TIMEOUT).get("code").asString()).isEqualTo("unknown_type");

			client.send("join", Map.of("roomId", "../etc"));
			assertThat(client.await("error", TIMEOUT).get("code").asString()).isEqualTo("bad_room_id");
		}
	}

	@Test
	void rejectsInvalidToken() {
		URI uri = URI.create("ws://localhost:" + port + "/ws?token=not-a-jwt");
		assertThatThrownBy(() -> new TestGameClient(uri, jsonMapper))
				.isInstanceOf(ExecutionException.class)
				.rootCause().hasMessageContaining("401");
	}

	@Test
	void answersPing() throws Exception {
		try (TestGameClient client = connect()) {
			client.send("ping", Map.of("ts", 1234));
			assertThat(client.await("pong", TIMEOUT).get("ts").asLong()).isEqualTo(1234);
		}
	}
}
