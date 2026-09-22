package dev.ascape.game.bot;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.Random;

import dev.ascape.game.match.Health;
import dev.ascape.game.match.PlayerInput;
import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Walkability;

/**
 * Monster AI as a finite state machine: PATROL generators → INVESTIGATE noises and scratch marks → CHASE a
 * visible survivor → SEARCH around where it was lost (lockers, sonar) → PATROL.
 */
final class MonsterBrain implements Brain {

	enum State {
		PATROL, INVESTIGATE, CHASE, SEARCH
	}

	private static final int LUNGE_MIN_DISTANCE = 3;
	private static final int LUNGE_MAX_DISTANCE = 6;
	private static final double SEARCH_SECONDS = 7;
	private static final double SONAR_AFTER_SEARCH_SECONDS = 1.5;
	private static final int SEARCH_LOCKER_RADIUS = 5;
	private static final double TRAP_CHANCE_AT_GENERATOR = 0.15;
	private static final double TRAP_MIN_PROGRESS = 0.3;
	private static final int INVESTIGATE_ARRIVAL_RADIUS = 2;

	private final GameRules rules;
	private final Difficulty difficulty;
	private State state = State.PATROL;
	private GridPos lastSeen;
	private GridPos investigateTarget;
	private int searchStartTick;
	private final List<GridPos> searchedLockers = new ArrayList<>();
	private Integer patrolGeneratorId;

	MonsterBrain(GameRules rules, Difficulty difficulty) {
		this.rules = rules;
		this.difficulty = difficulty;
	}

	@Override
	public String describe() {
		return state.name().toLowerCase();
	}

	@Override
	public Intent think(Perception perception, Navigator navigator, Walkability walkability, Random random) {
		Perception.Self self = perception.self();
		GridPos here = self.position();
		int tick = perception.tick();
		List<Perception.SeenActor> survivors = perception.visibleSurvivors().stream()
				.filter(s -> s.health().isInPlay())
				.toList();

		if (random.nextDouble() < difficulty.blunderChance) {
			navigator.goTo(walkability, here, "blunder", cell -> cell.chebyshevDistance(here) >= 3,
					here.plus(random.nextInt(9) - 4, random.nextInt(9) - 4), tick);
			return Intent.MOVE;
		}

		Optional<Perception.SeenActor> adjacentActive = nearest(survivors.stream()
				.filter(s -> s.health().isActive()).toList(), here)
				.filter(s -> s.position().chebyshevDistance(here) <= rules.monster().attackRange());
		if (adjacentActive.isPresent() && self.attackReady()) {
			lastSeen = adjacentActive.get().position();
			state = State.CHASE;
			return Intent.move(false, List.of(PlayerInput.ATTACK));
		}

		Optional<Perception.SeenActor> downed = nearest(survivors.stream()
				.filter(s -> s.health() == Health.DOWNED).toList(), here);
		Optional<Perception.SeenActor> active = nearest(survivors.stream()
				.filter(s -> s.health().isActive()).toList(), here);
		if (downed.isPresent() && active.map(a -> a.position().chebyshevDistance(here) > 2).orElse(true)) {
			GridPos target = downed.get().position();
			if (target.chebyshevDistance(here) <= 1) {
				navigator.stop();
				return Intent.hold(List.of());
			}
			navigator.goTo(walkability, here, "catch-" + downed.get().id(), cell -> cell.chebyshevDistance(target) <= 1,
					target, tick);
			return Intent.MOVE;
		}

		if (active.isPresent()) {
			state = State.CHASE;
			GridPos target = active.get().position();
			lastSeen = target;
			navigator.goTo(walkability, here, target, cell -> cell.chebyshevDistance(target) <= 1, target, tick);
			int distance = target.chebyshevDistance(here);
			if (self.lungeReady() && distance >= LUNGE_MIN_DISTANCE && distance <= LUNGE_MAX_DISTANCE) {
				return Intent.move(false, List.of(PlayerInput.LUNGE));
			}
			return Intent.MOVE;
		}

		if (state == State.CHASE) {
			state = State.SEARCH;
			searchStartTick = tick;
			searchedLockers.clear();
		}
		if (state == State.SEARCH) {
			Intent searching = search(perception, navigator, walkability, tick);
			if (searching != null) {
				return searching;
			}
		}

		Optional<GridPos> clue = clue(perception, here);
		if (clue.isPresent()) {
			state = State.INVESTIGATE;
			investigateTarget = clue.get();
		}
		if (state == State.INVESTIGATE && investigateTarget != null) {
			GridPos target = investigateTarget;
			if (target.chebyshevDistance(here) <= INVESTIGATE_ARRIVAL_RADIUS) {
				state = State.SEARCH;
				lastSeen = target;
				searchStartTick = tick;
				searchedLockers.clear();
				return Intent.MOVE;
			}
			navigator.goTo(walkability, here, "investigate", cell -> cell.chebyshevDistance(target) <= 1, target, tick);
			return Intent.MOVE;
		}

		return patrol(perception, navigator, walkability, random);
	}

	/** Checks lockers near where the survivor was lost and pings sonar; null when the search is over. */
	private Intent search(Perception perception, Navigator navigator, Walkability walkability, int tick) {
		GridPos here = perception.self().position();
		if (tick - searchStartTick > rules.ticks(SEARCH_SECONDS) || lastSeen == null) {
			state = State.PATROL;
			return null;
		}
		List<String> actions = perception.self().sonarReady()
				&& tick - searchStartTick > rules.ticks(SONAR_AFTER_SEARCH_SECONDS) ? List.of(PlayerInput.SONAR) : List.of();
		Optional<GridPos> locker = perception.lockers().stream()
				.filter(l -> l.chebyshevDistance(lastSeen) <= SEARCH_LOCKER_RADIUS && !searchedLockers.contains(l))
				.min(Comparator.comparingInt(l -> l.chebyshevDistance(here)));
		if (locker.isPresent()) {
			GridPos target = locker.get();
			if (target.chebyshevDistance(here) <= 1) {
				searchedLockers.add(target);
				navigator.stop();
				return Intent.press();
			}
			navigator.goTo(walkability, here, "locker-" + target, cell -> cell.chebyshevDistance(target) <= 1, target, tick);
			return Intent.move(false, actions);
		}
		GridPos target = lastSeen;
		navigator.goTo(walkability, here, "lost-" + target, cell -> cell.chebyshevDistance(target) <= 1, target, tick);
		return Intent.move(false, actions);
	}

	/** The loudest noise, else the freshest scratch mark. */
	private static Optional<GridPos> clue(Perception perception, GridPos here) {
		Optional<GridPos> sound = perception.sounds().stream()
				.max(Comparator.comparingDouble(Perception.HeardSound::intensity))
				.map(Perception.HeardSound::estimatedPosition);
		if (sound.isPresent()) {
			return sound;
		}
		return perception.trails().stream().max(Comparator.comparingInt(t -> -t.chebyshevDistance(here)));
	}

	/** Walks between generators, favouring ones seen with progress; sometimes leaves a trap there. */
	private Intent patrol(Perception perception, Navigator navigator, Walkability walkability, Random random) {
		state = State.PATROL;
		GridPos here = perception.self().position();
		List<Perception.KnownGenerator> open = perception.generators().stream().filter(g -> !g.done()).toList();
		if (open.isEmpty()) {
			GridPos gate = perception.gates().getFirst();
			navigator.goTo(walkability, here, "gate", cell -> cell.chebyshevDistance(gate) <= 2, gate,
					perception.tick());
			return Intent.MOVE;
		}
		Perception.KnownGenerator target = open.stream()
				.filter(g -> patrolGeneratorId != null && g.id() == patrolGeneratorId)
				.findFirst()
				.orElseGet(() -> open.stream()
						.max(Comparator.comparingDouble(g -> (g.progress() == null ? 0 : g.progress()) + random.nextDouble()))
						.orElseThrow());
		patrolGeneratorId = target.id();
		GridPos generator = target.position();
		if (isNextToGenerator(here, generator)) {
			patrolGeneratorId = null; // next think picks another
			boolean worthTrapping = target.progress() != null && target.progress() >= TRAP_MIN_PROGRESS;
			if (worthTrapping && perception.self().trapReady() && perception.self().trapsLeft() > 0
					&& random.nextDouble() < TRAP_CHANCE_AT_GENERATOR) {
				return Intent.move(false, List.of(PlayerInput.TRAP));
			}
			return Intent.MOVE;
		}
		navigator.goTo(walkability, here, "patrol-" + target.id(), cell -> isNextToGenerator(cell, generator),
				generator, perception.tick());
		return Intent.MOVE;
	}

	static boolean isNextToGenerator(GridPos cell, GridPos generator) {
		return Math.abs(cell.x() - generator.x()) <= 2 && Math.abs(cell.y() - generator.y()) <= 1;
	}

	private static Optional<Perception.SeenActor> nearest(List<Perception.SeenActor> actors, GridPos here) {
		return actors.stream().min(Comparator.comparingInt(a -> a.position().chebyshevDistance(here)));
	}
}
