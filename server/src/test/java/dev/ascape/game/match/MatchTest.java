package dev.ascape.game.match;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import dev.ascape.game.TestRules;
import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Movement.MoveState;
import dev.ascape.game.world.TestMaps;
import dev.ascape.game.world.TileMap;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class MatchTest {

	private static final GameRules RULES = TestRules.RULES;
	/** 5 generators at (4,2) (8,2) (12,2) (4,4) (8,4); a walled box at x 11-15, y 5-8; gate at (19,6..7). */
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
	private long seq;

	@BeforeEach
	void setUp() {
		match = new Match(ARENA, RULES, 42);
		monster = match.addActor(Role.MONSTER, "m", "M", "#c0392b");
		survivor = match.addActor(Role.SURVIVOR, "s", "@", "#ffffff");
	}

	// ------------------------------------------------------------ helpers

	private void place(Actor actor, int x, int y) {
		actor.move = new MoveState(new GridPos(x, y), 1.0);
	}

	private PlayerInput input(int dx, int dy, boolean interact, String... actions) {
		return new PlayerInput(++seq, dx, dy, false, interact, List.of(actions));
	}

	private PlayerInput idle() {
		return input(0, 0, false);
	}

	private void tick(Map<Actor, PlayerInput> inputs) {
		Map<Integer, PlayerInput> byId = new HashMap<>();
		inputs.forEach((actor, in) -> byId.put(actor.id(), in));
		match.tick(byId);
	}

	private void tickFor(double seconds, Map<Actor, PlayerInput> inputs) {
		for (int i = 0; i < RULES.ticks(seconds); i++) {
			tick(inputs);
		}
	}

	// ------------------------------------------------------------ objectives

	/** Holds interact on the generator and hits every skill check, like a good player. */
	private int repairUntilDone(Generator generator, int maxTicks) {
		for (int ticks = 1; ticks <= maxTicks; ticks++) {
			boolean checkOpen = survivor.skillCheckPending() && match.tick() + 1 >= survivor.skillCheckStartTick();
			tick(Map.of(survivor, checkOpen ? input(0, 0, true, PlayerInput.SKILL_CHECK) : input(0, 0, true)));
			if (generator.done()) {
				return ticks;
			}
		}
		return -1;
	}

	@Test
	void soloRepairTakesAboutTheConfiguredTime() {
		place(survivor, 4, 3);
		Generator generator = match.generators().getFirst();
		int solo = RULES.ticks(RULES.survivor().repairSecondsSolo());

		int ticks = repairUntilDone(generator, solo * 2);

		// Successful skill checks add a small bonus, so it can finish somewhat early, never late.
		assertThat(ticks).isBetween((int) (solo * 0.8), solo);
		assertThat(match.generatorsDone()).isEqualTo(1);
		assertThat(match.drainEvents()).anyMatch(e -> e instanceof MatchEvent.GeneratorDone);
	}

	@Test
	void missedSkillCheckCostsProgress() {
		place(survivor, 4, 3);
		Generator generator = match.generators().getFirst();
		while (!survivor.skillCheckPending()) {
			tick(Map.of(survivor, input(0, 0, true)));
		}
		double before = generator.progress();

		// Pressing before the window opens fails the check.
		tick(Map.of(survivor, input(0, 0, true, PlayerInput.SKILL_CHECK)));

		assertThat(generator.progress()).isLessThan(before);
		assertThat(match.sounds()).anyMatch(sound -> sound.kind().equals("explosion"));
	}

	@Test
	void movingInterruptsRepair() {
		place(survivor, 4, 3);
		tickFor(1, Map.of(survivor, input(0, 0, true)));
		double progress = match.generators().getFirst().progress();

		tick(Map.of(survivor, input(1, 0, true)));

		assertThat(match.generators().getFirst().progress()).isEqualTo(progress);
		assertThat(survivor.activity()).isEqualTo(Actor.Activity.NONE);
	}

	@Test
	void gateOpensAfterEnoughGeneratorsAndAnEscapeWinsForSurvivors() {
		for (Generator generator : match.generators()) {
			generator.progress = 0.9999;
		}
		int[][] spots = { { 4, 3 }, { 8, 3 }, { 12, 3 }, { 4, 5 }, { 8, 5 } };
		for (int[] spot : spots) {
			place(survivor, spot[0], spot[1]);
			tick(Map.of(survivor, input(0, 0, true)));
			tick(Map.of(survivor, idle()));
		}
		assertThat(match.phase()).isEqualTo(Match.Phase.ENDGAME);
		assertThat(match.gateOpen()).isTrue();

		place(survivor, 18, 6);
		tick(Map.of(survivor, input(1, 0, false)));

		assertThat(survivor.health()).isEqualTo(Health.ESCAPED);
		assertThat(match.phase()).isEqualTo(Match.Phase.FINISHED);
		assertThat(match.winner()).contains(Match.Winner.SURVIVORS);
		assertThat(survivor.stats().score()).isGreaterThan(0);
	}

	@Test
	void monsterWinsWhenTimeRunsOut() {
		tickFor(RULES.match().durationSeconds() + 1, Map.of());

		assertThat(match.phase()).isEqualTo(Match.Phase.FINISHED);
		assertThat(match.winner()).contains(Match.Winner.MONSTER);
		assertThat(survivor.health()).isEqualTo(Health.CAUGHT);
	}

	// ------------------------------------------------------------ combat

	@Test
	void attackInjuresThenDownsThenCatches() {
		place(survivor, 5, 7);
		place(monster, 5, 6);

		tick(Map.of(monster, input(0, 0, false, PlayerInput.ATTACK)));
		assertThat(survivor.health()).isEqualTo(Health.INJURED);

		// Still on cooldown: a second swing right away does nothing.
		tick(Map.of(monster, input(0, 0, false, PlayerInput.ATTACK)));
		assertThat(survivor.health()).isEqualTo(Health.INJURED);

		tickFor(RULES.monster().attackCooldownSeconds(), Map.of());
		place(survivor, 5, 7);
		tick(Map.of(monster, input(0, 0, false, PlayerInput.ATTACK)));
		assertThat(survivor.health()).isEqualTo(Health.DOWNED);

		tick(Map.of(monster, input(0, 0, true)));
		assertThat(survivor.health()).as("catching takes a moment").isEqualTo(Health.DOWNED);
		tickFor(RULES.monster().catchSeconds(), Map.of(monster, input(0, 0, true)));
		assertThat(survivor.health()).isEqualTo(Health.CAUGHT);
		assertThat(monster.stats().catches()).isEqualTo(1);
	}

	@Test
	void missStillCostsCooldownAndSlowsTheMonster() {
		place(survivor, 9, 9);
		place(monster, 5, 6);
		double normal = match.speed(monster, false);

		tick(Map.of(monster, input(0, 0, false, PlayerInput.ATTACK)));

		assertThat(survivor.health()).isEqualTo(Health.HEALTHY);
		assertThat(monster.attackCooldownTicks()).isPositive();
		assertThat(match.speed(monster, false)).isLessThan(normal);
	}

	@Test
	void teammateRevivesDownedSurvivor() {
		Actor helper = match.addActor(Role.SURVIVOR, "h", "@", "#ffffff");
		survivor.health = Health.DOWNED;
		survivor.bleedOutTicks = 1_000;
		place(survivor, 5, 7);
		place(helper, 6, 7);

		tickFor(RULES.survivor().reviveSeconds() + 0.1, Map.of(helper, input(0, 0, true)));

		assertThat(survivor.health()).isEqualTo(Health.INJURED);
		assertThat(helper.stats().revives()).isEqualTo(1);
	}

	@Test
	void downedSurvivorBleedsOut() {
		survivor.health = Health.DOWNED;
		survivor.bleedOutTicks = 3;

		tickFor(0.25, Map.of());

		assertThat(survivor.health()).isEqualTo(Health.CAUGHT);
	}

	// ------------------------------------------------------------ lockers, traps, movement

	@Test
	void lockerHidesSurvivorUntilTheMonsterPullsThemOut() {
		place(survivor, 7, 8);
		tick(Map.of(survivor, input(0, 0, true)));
		assertThat(survivor.hidden()).isTrue();

		place(monster, 7, 7);
		assertThat(match.visibility().canSee(monster, survivor)).isFalse();

		tick(Map.of(monster, input(0, 0, true)));
		assertThat(survivor.hidden()).isFalse();
		assertThat(survivor.health()).as("being pulled out counts as a hit").isEqualTo(Health.INJURED);
	}

	@Test
	void teammateHealsInjuredSurvivor() {
		Actor helper = match.addActor(Role.SURVIVOR, "h", "@", "#ffffff");
		survivor.health = Health.INJURED;
		place(survivor, 5, 7);
		place(helper, 6, 7);

		tickFor(RULES.survivor().healSeconds() + 0.1, Map.of(helper, input(0, 0, true)));

		assertThat(survivor.health()).isEqualTo(Health.HEALTHY);
		assertThat(helper.stats().heals()).isEqualTo(1);
	}

	@Test
	void survivorCanLeaveLockerAgain() {
		place(survivor, 7, 8);
		tick(Map.of(survivor, input(0, 0, true)));
		tick(Map.of(survivor, input(0, 0, false)));
		tick(Map.of(survivor, input(0, 0, true)));

		assertThat(survivor.hidden()).isFalse();
		assertThat(survivor.position()).isEqualTo(new GridPos(7, 8));
	}

	@Test
	void trapStopsASurvivor() {
		place(monster, 4, 7);
		tick(Map.of(monster, input(0, 0, false, PlayerInput.TRAP)));
		place(monster, 1, 1);
		place(survivor, 3, 7);

		tick(Map.of(survivor, input(1, 0, false)));
		assertThat(survivor.position()).isEqualTo(new GridPos(4, 7));
		assertThat(survivor.trapped()).isTrue();

		tick(Map.of(survivor, input(1, 0, false)));
		assertThat(survivor.position()).isEqualTo(new GridPos(4, 7));
		assertThat(match.traps()).isEmpty();
	}

	@Test
	void starvedActorsDoNotMove() {
		place(survivor, 3, 7);
		tickFor(1, Map.of());
		assertThat(survivor.position()).isEqualTo(new GridPos(3, 7));
	}

	@Test
	void sprintDrainsStaminaAndLeavesTrail() {
		place(survivor, 1, 9);
		double before = survivor.stamina();

		for (int i = 0; i < RULES.ticks(1); i++) {
			tick(Map.of(survivor, new PlayerInput(++seq, 1, 0, true, false, List.of())));
		}

		assertThat(survivor.stamina()).isLessThan(before);
		assertThat(match.trails()).isNotEmpty();
		assertThat(match.sounds()).anyMatch(sound -> sound.kind().equals("footsteps"));
	}

	// ------------------------------------------------------------ visibility

	@Test
	void monsterSeesNearbySurvivorsButNotThroughWalls() {
		place(monster, 13, 6); // inside the walled box
		place(survivor, 9, 6);
		assertThat(match.visibility().canSee(monster, survivor)).isFalse();

		place(monster, 8, 6);
		match.tick(Map.of()); // field of view is cached per tick
		assertThat(match.visibility().canSee(monster, survivor)).isTrue();
	}

	@Test
	void darkSurvivorsAreOnlyVisibleUpClose() {
		place(monster, 1, 1);
		place(survivor, 12, 1); // 11 cells away, clear line: beyond dark vision, within light spotting
		survivor.flashlightOn = false;
		assertThat(match.visibility().canSee(monster, survivor)).isFalse();

		survivor.flashlightOn = true;
		match.tick(Map.of()); // invalidate cached field of view
		assertThat(match.visibility().canSee(monster, survivor)).isTrue();
	}

	@Test
	void sonarRevealsSurvivorsThroughWalls() {
		place(monster, 1, 1);
		place(survivor, 13, 6);
		survivor.flashlightOn = false;
		assertThat(match.visibility().canSee(monster, survivor)).isFalse();

		tick(Map.of(monster, input(0, 0, false, PlayerInput.SONAR)));

		assertThat(match.visibility().canSee(monster, survivor)).isTrue();
	}

	@Test
	void survivorsSeeTheMonsterOnlyInTheirLightOrRightNextToThem() {
		place(survivor, 1, 9);
		place(monster, 12, 9);
		assertThat(match.visibility().canSee(survivor, monster)).isFalse();

		place(monster, 3, 9);
		match.tick(Map.of());
		assertThat(match.visibility().canSee(survivor, monster)).isTrue();
	}
}
