package dev.ascape.game.world;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import dev.ascape.game.world.Movement.MoveState;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/** Runs shared/fixtures/movement-cases.json; the client runs the same file, keeping prediction in sync. */
class MovementParityTest {

	private static final Path FIXTURE = Path.of("../shared/fixtures/movement-cases.json");
	private static final double TOLERANCE = 1e-9;

	static Stream<Arguments> cases() {
		JsonNode root = JsonMapper.builder().build().readTree(FIXTURE.toFile());
		List<Arguments> cases = new ArrayList<>();
		root.get("cases").forEach(node -> cases.add(Arguments.of(node.get("name").asString(), node)));
		return cases.stream();
	}

	@ParameterizedTest(name = "{0}")
	@MethodSource("cases")
	void matchesFixture(String name, JsonNode testCase) {
		List<String> rows = new ArrayList<>();
		testCase.get("map").forEach(row -> rows.add(row.asString()));
		TileMap map = TestMaps.of(rows.toArray(String[]::new));
		int tickRate = testCase.get("tickRate").asInt();
		JsonNode start = testCase.get("start");
		MoveState state = new MoveState(new GridPos(start.get("x").asInt(), start.get("y").asInt()),
				start.get("progress").asDouble());

		for (JsonNode input : testCase.get("inputs")) {
			for (int i = 0; i < input.get("repeat").asInt(); i++) {
				state = Movement.advance(TestMaps.staticWalkability(map), state, input.get("dx").asInt(),
						input.get("dy").asInt(), input.get("speed").asDouble(), tickRate);
			}
		}

		JsonNode expected = testCase.get("expected");
		assertThat(state.position()).isEqualTo(new GridPos(expected.get("x").asInt(), expected.get("y").asInt()));
		assertThat(state.progress()).isCloseTo(expected.get("progress").asDouble(), within(TOLERANCE));
	}
}
