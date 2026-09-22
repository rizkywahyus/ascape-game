package dev.ascape.game.room;

import static dev.ascape.game.match.MatchTestAccess.place;
import static dev.ascape.game.match.MatchTestAccess.setFlashlight;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.offset;

import java.util.List;
import java.util.Map;

import dev.ascape.game.TestRules;
import dev.ascape.game.match.Actor;
import dev.ascape.game.match.Match;
import dev.ascape.game.match.PlayerInput;
import dev.ascape.game.match.Role;
import dev.ascape.game.world.TestMaps;
import dev.ascape.game.world.TileMap;
import dev.ascape.net.protocol.ServerMessages.EntityView;
import dev.ascape.net.protocol.ServerMessages.Snapshot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The per-viewer snapshot is the anti-wallhack boundary: whatever a client may not see must never be serialised.
 */
class SnapshotVisibilityTest {

	private static final TileMap ARENA = TestMaps.of(
			"####################",
			"#M.................#",
			"#..[G].[G].[G].....#",
			"#..................#",
			"#..[G].[G].........#",
			"#..........#####...#",
			"#..........#...#...E",
			"#..........#...#...E",
			"#SS...L....#####...#",
			"#SS................#",
			"####################");

	private Match match;
	private Actor monster;
	private Actor survivor;
	private Actor teammate;

	@BeforeEach
	void setUp() {
		match = new Match(ARENA, TestRules.RULES, 7);
		monster = match.addActor(Role.MONSTER, "m", "M", "#c0392b");
		survivor = match.addActor(Role.SURVIVOR, "s", "@", "#ffffff");
		teammate = match.addActor(Role.SURVIVOR, "t", "@", "#5dade2");
	}

	private Snapshot snapshotFor(Actor viewer) {
		match.tick(Map.of()); // fresh field of view for the new positions
		return SnapshotBuilder.build(match, viewer, match.tick(), 0, false);
	}

	private static List<Integer> ids(Snapshot snapshot) {
		return snapshot.entities().stream().map(EntityView::id).toList();
	}

	@Test
	void monsterBehindWallsNeverReachesSurvivorSnapshot() {
		place(survivor, 9, 6);
		place(monster, 13, 6); // inside the walled box, 4 cells away

		assertThat(ids(snapshotFor(survivor))).doesNotContain(monster.id());
	}

	@Test
	void survivorsInTheDarkNeverReachMonsterSnapshot() {
		place(monster, 1, 1);
		place(survivor, 12, 1); // 11 cells away in the open, flashlight off
		place(teammate, 13, 6); // behind walls, flashlight on
		setFlashlight(survivor, false);
		setFlashlight(teammate, true);

		assertThat(ids(snapshotFor(monster))).containsExactly(monster.id());
	}

	@Test
	void teammatesAreAlwaysShownToSurvivors() {
		place(survivor, 1, 9);
		place(teammate, 13, 6);

		assertThat(ids(snapshotFor(survivor))).contains(survivor.id(), teammate.id());
	}

	@Test
	void hiddenSurvivorIsInvisibleEvenToTeammates() {
		place(survivor, 7, 8);
		match.tick(Map.of(survivor.id(), new PlayerInput(1, 0, 0, false, true, List.of())));
		assertThat(survivor.hidden()).isTrue();

		assertThat(ids(snapshotFor(teammate))).doesNotContain(survivor.id());
		assertThat(ids(snapshotFor(monster))).doesNotContain(survivor.id());
	}

	@Test
	void monsterHearsDirectionNotPosition() {
		place(monster, 1, 1);
		place(survivor, 8, 3); // steps to (9,3): ~8.2 cells away in the dark, beyond sight, within footstep range
		setFlashlight(survivor, false);
		match.tick(Map.of(survivor.id(), new PlayerInput(1, 1, 0, true, false, List.of())));

		Snapshot snapshot = SnapshotBuilder.build(match, monster, match.tick(), 0, false);

		assertThat(snapshot.sounds()).isNotEmpty().allSatisfy(sound -> {
			assertThat(Math.hypot(sound.dx(), sound.dy())).isCloseTo(1.0, offset(0.01));
			assertThat(sound.intensity()).isBetween(0.0, 1.0);
		});
		assertThat(ids(snapshot)).doesNotContain(survivor.id());
	}

	@Test
	void survivorsGetNoSoundsTrailsOrFarTraps() {
		place(monster, 16, 9);
		match.tick(Map.of(monster.id(), new PlayerInput(1, 0, 0, false, false, List.of(PlayerInput.TRAP))));
		place(survivor, 1, 9);
		match.tick(Map.of(survivor.id(), new PlayerInput(1, 1, 0, true, false, List.of())));

		Snapshot snapshot = SnapshotBuilder.build(match, survivor, match.tick(), 0, false);

		assertThat(snapshot.sounds()).isEmpty();
		assertThat(snapshot.trails()).isEmpty();
		assertThat(snapshot.traps()).isEmpty();
	}

	@Test
	void generatorProgressIsHiddenOutOfSight() {
		place(survivor, 13, 6); // inside the box: no generator in view
		setFlashlight(survivor, false);

		Snapshot snapshot = snapshotFor(survivor);

		assertThat(snapshot.generators()).allSatisfy(generator -> assertThat(generator.progress()).isNull());
	}
}
