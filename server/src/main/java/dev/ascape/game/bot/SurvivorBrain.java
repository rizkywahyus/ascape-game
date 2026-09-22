package dev.ascape.game.bot;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Random;

import dev.ascape.game.match.Health;
import dev.ascape.game.match.PlayerInput;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.LineOfSight;
import dev.ascape.game.world.Walkability;

/**
 * Survivor AI as utility scoring: each think it scores ESCAPE, FLEE, HIDE, REVIVE and REPAIR from what it
 * perceives (monster distance, heartbeat, teammates, generator progress, stamina) and acts on the best.
 */
final class SurvivorBrain implements Brain {

	enum Goal {
		IDLE, ESCAPE, FLEE, HIDE, REVIVE, HEAL, REPAIR
	}

	private static final int DANGER_DISTANCE = 7;
	private static final double DANGER_TERROR = 0.45;
	private static final double SAFE_TERROR = 0.15;
	private static final double MEMORY_SECONDS = 4;
	private static final double LEAVE_LOCKER_AFTER_SAFE_SECONDS = 3;
	private static final int HIDE_LOCKER_RADIUS = 3;
	private static final double HIDE_CHANCE = 0.5;
	private static final double SPRINT_STAMINA = 20;
	private static final double THROW_CHANCE = 0.1;
	private static final int THROW_DISTANCE = 6;
	private static final double REVIVE_MAX_TERROR = 0.4;
	private static final double FLASHLIGHT_OFF_TERROR = 0.5;
	private static final int FLEE_CANDIDATES = 24;
	private static final int FLEE_RANGE = 10;
	private static final int AVOID_GENERATOR_RADIUS = 6;
	private static final double OUT_OF_SIGHT_BONUS = 6;
	private static final int HEAL_RADIUS = 8;

	private final Difficulty difficulty;
	private final int tickRate;
	private Goal goal = Goal.IDLE;
	private GridPos lastMonster;
	private int lastMonsterTick = Integer.MIN_VALUE;
	private int safeSinceTick = Integer.MIN_VALUE;
	private Integer repairGeneratorId;
	private GridPos hideLocker;
	private boolean decidedToHide;

	SurvivorBrain(Difficulty difficulty, int tickRate) {
		this.difficulty = difficulty;
		this.tickRate = tickRate;
	}

	@Override
	public String describe() {
		return goal.name().toLowerCase();
	}

	@Override
	public Intent think(Perception perception, Navigator navigator, Walkability walkability, Random random) {
		Perception.Self self = perception.self();
		GridPos here = self.position();
		int tick = perception.tick();
		perception.visibleMonsters().stream().findFirst().ifPresent(monster -> {
			lastMonster = monster.position();
			lastMonsterTick = tick;
		});
		boolean monsterRemembered = tick - lastMonsterTick <= MEMORY_SECONDS * tickRate && lastMonster != null;
		boolean danger = monsterRemembered && (lastMonster.chebyshevDistance(here) <= DANGER_DISTANCE
				|| perception.terror() >= DANGER_TERROR);
		if (perception.terror() > SAFE_TERROR || danger) {
			safeSinceTick = tick;
		}

		if (self.health() == Health.DOWNED) {
			navigator.stop();
			goal = Goal.IDLE;
			return Intent.MOVE;
		}
		if (self.hidden()) {
			goal = Goal.HIDE;
			boolean safeLongEnough = tick - safeSinceTick >= LEAVE_LOCKER_AFTER_SAFE_SECONDS * tickRate;
			return safeLongEnough ? Intent.press() : Intent.MOVE;
		}
		if (random.nextDouble() < difficulty.blunderChance) {
			navigator.goTo(walkability, here, "wander", cell -> cell.chebyshevDistance(here) >= 3,
					here.plus(random.nextInt(9) - 4, random.nextInt(9) - 4), tick);
			return Intent.MOVE;
		}
		List<String> actions = flashlightActions(self, perception.terror(), danger);

		if (perception.gateOpen()) {
			goal = Goal.ESCAPE;
			GridPos gate = perception.gates().stream().min(Comparator.comparingInt(g -> g.chebyshevDistance(here)))
					.orElseThrow();
			navigator.goTo(walkability, here, "gate", gate::equals, gate, tick);
			return Intent.move(danger && self.stamina() > SPRINT_STAMINA, actions);
		}
		if (danger) {
			return avoidMonster(perception, navigator, walkability, random, actions);
		}
		decidedToHide = false;
		hideLocker = null;

		Optional<Perception.SeenActor> downedTeammate = perception.visibleSurvivors().stream()
				.filter(s -> s.health() == Health.DOWNED)
				.min(Comparator.comparingInt(s -> s.position().chebyshevDistance(here)));
		if (downedTeammate.isPresent() && perception.terror() < REVIVE_MAX_TERROR) {
			goal = Goal.REVIVE;
			GridPos target = downedTeammate.get().position();
			if (target.chebyshevDistance(here) <= 1) {
				navigator.stop();
				return Intent.hold(actions);
			}
			navigator.goTo(walkability, here, "revive-" + downedTeammate.get().id(),
					cell -> cell.chebyshevDistance(target) <= 1, target, tick);
			return Intent.move(false, actions);
		}
		Optional<Perception.SeenActor> injuredTeammate = perception.visibleSurvivors().stream()
				.filter(s -> s.health() == Health.INJURED && s.position().chebyshevDistance(here) <= HEAL_RADIUS)
				.findFirst();
		if (injuredTeammate.isPresent() && perception.terror() == 0 && self.health() == Health.HEALTHY) {
			goal = Goal.HEAL;
			GridPos target = injuredTeammate.get().position();
			if (target.chebyshevDistance(here) <= 1) {
				navigator.stop();
				return Intent.hold(actions);
			}
			navigator.goTo(walkability, here, "heal-" + injuredTeammate.get().id(),
					cell -> cell.chebyshevDistance(target) <= 1, target, tick);
			return Intent.move(false, actions);
		}
		return repair(perception, navigator, walkability, actions);
	}

	private Intent avoidMonster(Perception perception, Navigator navigator, Walkability walkability, Random random,
			List<String> actions) {
		GridPos here = perception.self().position();
		int tick = perception.tick();
		if (!decidedToHide && hideLocker == null) {
			decidedToHide = true;
			boolean monsterNotOnTop = lastMonster.chebyshevDistance(here) > HIDE_LOCKER_RADIUS;
			hideLocker = monsterNotOnTop && random.nextDouble() < HIDE_CHANCE
					? perception.lockers().stream()
							.filter(l -> l.chebyshevDistance(here) <= HIDE_LOCKER_RADIUS)
							.min(Comparator.comparingInt(l -> l.chebyshevDistance(here)))
							.orElse(null)
					: null;
		}
		if (hideLocker != null) {
			goal = Goal.HIDE;
			GridPos locker = hideLocker;
			if (locker.chebyshevDistance(here) <= 1) {
				navigator.stop();
				hideLocker = null;
				return Intent.press();
			}
			navigator.goTo(walkability, here, "hide-" + locker, cell -> cell.chebyshevDistance(locker) <= 1, locker, tick);
			return Intent.move(true, actions);
		}
		goal = Goal.FLEE;
		GridPos refuge = fleeTarget(perception, here, walkability, random);
		navigator.goTo(walkability, here, "flee-" + refuge, refuge::equals, refuge, tick);
		List<String> fleeActions = new ArrayList<>(actions);
		boolean monsterClose = perception.visibleMonsters().stream()
				.anyMatch(m -> m.position().chebyshevDistance(here) <= THROW_DISTANCE);
		if (monsterClose && perception.self().rocks() > 0 && random.nextDouble() < THROW_CHANCE) {
			fleeActions.add(PlayerInput.THROW);
		}
		// Sprinting is loud and leaves marks: only worth it while the monster can actually see us.
		boolean seen = !perception.visibleMonsters().isEmpty();
		return Intent.move(seen && perception.self().stamina() > SPRINT_STAMINA, fleeActions);
	}

	/**
	 * A reachable cell far from the monster, not too far from us, preferably out of the monster's line of sight
	 * (the map layout is public, so reasoning about walls is fair).
	 */
	private GridPos fleeTarget(Perception perception, GridPos here, Walkability walkability, Random random) {
		GridPos best = here;
		double bestScore = Double.NEGATIVE_INFINITY;
		for (int i = 0; i < FLEE_CANDIDATES; i++) {
			GridPos candidate = here.plus(random.nextInt(2 * FLEE_RANGE + 1) - FLEE_RANGE,
					random.nextInt(2 * FLEE_RANGE + 1) - FLEE_RANGE);
			if (!walkability.isWalkable(candidate.x(), candidate.y())) {
				continue;
			}
			boolean hidden = !LineOfSight.isClear(perception.map(), lastMonster, candidate);
			double score = candidate.chebyshevDistance(lastMonster) - 0.3 * candidate.chebyshevDistance(here)
					+ (hidden ? OUT_OF_SIGHT_BONUS : 0);
			if (score > bestScore) {
				bestScore = score;
				best = candidate;
			}
		}
		return best;
	}

	/** Works on the nearest unfinished generator away from where the monster was last seen. */
	private Intent repair(Perception perception, Navigator navigator, Walkability walkability, List<String> actions) {
		GridPos here = perception.self().position();
		int tick = perception.tick();
		List<Perception.KnownGenerator> open = perception.generators().stream().filter(g -> !g.done()).toList();
		if (open.isEmpty()) {
			goal = Goal.IDLE;
			return Intent.MOVE;
		}
		boolean monsterRecent = lastMonster != null && tick - lastMonsterTick <= 3 * MEMORY_SECONDS * tickRate;
		Perception.KnownGenerator target = open.stream()
				.filter(g -> repairGeneratorId != null && g.id() == repairGeneratorId)
				.findFirst()
				.orElseGet(() -> open.stream()
						.min(Comparator.comparingInt((Perception.KnownGenerator g) -> g.position().chebyshevDistance(here)
								+ (monsterRecent && g.position().chebyshevDistance(lastMonster) <= AVOID_GENERATOR_RADIUS
										? 1_000 : 0)))
						.orElseThrow());
		repairGeneratorId = target.id();
		goal = Goal.REPAIR;
		GridPos generator = target.position();
		if (MonsterBrain.isNextToGenerator(here, generator)) {
			navigator.stop();
			return Intent.hold(actions);
		}
		navigator.goTo(walkability, here, "repair-" + target.id(), cell -> MonsterBrain.isNextToGenerator(cell, generator),
				generator, tick);
		return Intent.move(false, actions);
	}

	/** Light off while the monster is near (it spots lights from twice as far as it sees in the dark). */
	private static List<String> flashlightActions(Perception.Self self, double terror, boolean danger) {
		boolean wantLight = terror < FLASHLIGHT_OFF_TERROR && !danger;
		return wantLight != self.flashlightOn() ? List.of(PlayerInput.FLASHLIGHT) : List.of();
	}
}
