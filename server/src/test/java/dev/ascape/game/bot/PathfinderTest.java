package dev.ascape.game.bot;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Movement;
import dev.ascape.game.world.TestMaps;
import dev.ascape.game.world.TileMap;
import dev.ascape.game.world.Walkability;
import org.junit.jupiter.api.Test;

class PathfinderTest {

	private static final TileMap MAP = TestMaps.of(
			"##########",
			"#........#",
			"#.######.#",
			"#......#.#",
			"########.#",
			"#........#",
			"##########");
	private static final Walkability WALKABLE = TestMaps.staticWalkability(MAP);
	private final Pathfinder pathfinder = new Pathfinder(MAP.width(), MAP.height());

	@Test
	void findsShortestKingMovePath() {
		List<GridPos> path = pathfinder.find(WALKABLE, new GridPos(1, 1), new GridPos(8, 1));
		assertThat(path).hasSize(7).last().isEqualTo(new GridPos(8, 1));
	}

	@Test
	void walksAroundWalls() {
		List<GridPos> path = pathfinder.find(WALKABLE, new GridPos(1, 3), new GridPos(1, 5));
		assertThat(path).isNotEmpty().last().isEqualTo(new GridPos(1, 5));
		assertThat(path).allSatisfy(cell -> assertThat(MAP.isSolid(cell.x(), cell.y())).isFalse());
	}

	@Test
	void everyStepIsOneTheMovementCodeTakes() {
		GridPos at = new GridPos(1, 3);
		for (GridPos next : pathfinder.find(WALKABLE, at, new GridPos(1, 5))) {
			GridPos stepped = Movement.tryStep(WALKABLE, at, Integer.signum(next.x() - at.x()),
					Integer.signum(next.y() - at.y()));
			assertThat(stepped).isEqualTo(next);
			at = next;
		}
	}

	@Test
	void returnsEmptyWhenUnreachable() {
		TileMap split = TestMaps.of("#####", "#.#.#", "#####");
		Pathfinder small = new Pathfinder(split.width(), split.height());
		assertThat(small.find(TestMaps.staticWalkability(split), new GridPos(1, 1), new GridPos(3, 1))).isEmpty();
	}
}
