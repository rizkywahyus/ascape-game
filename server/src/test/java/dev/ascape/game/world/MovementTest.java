package dev.ascape.game.world;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ascape.game.world.Movement.MoveState;
import org.junit.jupiter.api.Test;

class MovementTest {

	private static final int TICK_RATE = 20;
	private static final TileMap ROOM = TestMaps.of(
			"#####",
			"#S..#",
			"#.#.#",
			"#...#",
			"#####");
	private static final Walkability WALKABLE = TestMaps.staticWalkability(ROOM);

	@Test
	void stepsOntoFloor() {
		assertThat(Movement.tryStep(WALKABLE, new GridPos(1, 1), 1, 0)).isEqualTo(new GridPos(2, 1));
	}

	@Test
	void staysAgainstWall() {
		assertThat(Movement.tryStep(WALKABLE, new GridPos(1, 1), -1, 0)).isEqualTo(new GridPos(1, 1));
	}

	@Test
	void slidesAlongWallWhenDiagonalBlocked() {
		assertThat(Movement.tryStep(WALKABLE, new GridPos(1, 1), 1, -1)).isEqualTo(new GridPos(2, 1));
	}

	@Test
	void neverCutsCorners() {
		TileMap corner = TestMaps.of("####", "#S##", "##.#", "####");
		assertThat(Movement.tryStep(TestMaps.staticWalkability(corner), new GridPos(1, 1), 1, 1))
				.isEqualTo(new GridPos(1, 1));
	}

	@Test
	void firstStepFromRestIsImmediate() {
		MoveState rested = new MoveState(new GridPos(1, 1), 1.0);

		MoveState next = Movement.advance(WALKABLE, rested, 1, 0, 5.0, TICK_RATE);

		assertThat(next.position()).isEqualTo(new GridPos(2, 1));
		assertThat(next.progress()).isEqualTo(0.25);
	}

	@Test
	void movesAtConfiguredSpeed() {
		TileMap corridor = TestMaps.of("#############", "#S..........#", "#############");
		MoveState state = new MoveState(new GridPos(1, 1), 0.0);

		for (int tick = 0; tick < TICK_RATE; tick++) {
			state = Movement.advance(TestMaps.staticWalkability(corridor), state, 1, 0, 5.0, TICK_RATE);
		}

		assertThat(state.position()).isEqualTo(new GridPos(6, 1));
	}

	@Test
	void idleProgressIsCappedSoTappingCannotOutrunHolding() {
		MoveState state = new MoveState(new GridPos(1, 1), 0.0);
		for (int tick = 0; tick < 100; tick++) {
			state = Movement.advance(WALKABLE, state, 0, 0, 5.0, TICK_RATE);
		}
		assertThat(state.progress()).isEqualTo(1.0);
	}

	@Test
	void blockedMoveKeepsProgressCapped() {
		MoveState state = Movement.advance(WALKABLE, new MoveState(new GridPos(1, 1), 1.0), -1, 0, 5.0, TICK_RATE);

		assertThat(state.position()).isEqualTo(new GridPos(1, 1));
		assertThat(state.progress()).isEqualTo(1.0);
	}
}
