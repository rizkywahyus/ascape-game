package dev.ascape.game.bot;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Optional;
import java.util.Random;

import dev.ascape.game.match.Actor;
import dev.ascape.game.match.Match;
import dev.ascape.game.match.PlayerInput;
import dev.ascape.game.match.Role;
import dev.ascape.game.world.GridPos;

/**
 * Drives one actor by producing the same {@link PlayerInput}s a human would send, through the same room input path.
 * It perceives through {@link PerceptionBuilder} only, thinks a few times per second on slightly stale perception
 * (its reaction time), and follows its plan every tick in between.
 */
public class Bot {

	/** Thinking every tick is wasteful and inhumanly twitchy; 5 decisions per second at 20 Hz. */
	static final int THINK_INTERVAL_TICKS = 4;

	private final Difficulty difficulty;
	private final Random random;
	private final Deque<Perception> history = new ArrayDeque<>();
	private Brain brain;
	private Navigator navigator;
	private Role role;
	private Intent intent = Intent.MOVE;
	private final List<String> pendingActions = new ArrayList<>();
	private boolean pressPending;
	private boolean interactWasHeld;
	private long seq;
	private int thinkPhase;
	/** Skill check the bot has already decided about: pressed on time, early, or not at all. */
	private int handledSkillCheckStart = -1;
	private int skillCheckPressTick = -1;

	public Bot(Difficulty difficulty, long seed) {
		this.difficulty = difficulty;
		this.random = new Random(seed);
		this.thinkPhase = random.nextInt(THINK_INTERVAL_TICKS);
	}

	public PlayerInput nextInput(Match match, Actor self) {
		ensureBrain(match, self);
		Perception now = PerceptionBuilder.build(match, self, difficulty, random);
		history.addLast(now);
		while (history.size() > difficulty.reactionTicks + 1) {
			history.removeFirst();
		}
		if ((now.tick() + thinkPhase) % THINK_INTERVAL_TICKS == 0) {
			// Decide on what was seen reactionTicks ago, but from where we stand now.
			Perception delayed = withCurrentSelf(history.peekFirst(), now);
			intent = brain.think(delayed, navigator, match.walkability(), random);
			pendingActions.addAll(intent.actions());
			pressPending |= intent.pressInteract();
		}
		return toInput(now);
	}

	/** What the bot is doing and where it is heading; dev-only debug view. */
	public record DebugInfo(String state, List<GridPos> path) {
	}

	public DebugInfo debugInfo() {
		return brain == null ? new DebugInfo("thinking", List.of())
				: new DebugInfo(brain.describe(), List.copyOf(navigator.remainingPath()));
	}

	private void ensureBrain(Match match, Actor self) {
		if (brain != null && role == self.role()) {
			return;
		}
		role = self.role();
		navigator = new Navigator(new Pathfinder(match.map().width(), match.map().height()));
		brain = role == Role.MONSTER ? new MonsterBrain(match.rules(), difficulty)
				: new SurvivorBrain(difficulty, match.rules().tickRate());
	}

	private PlayerInput toInput(Perception now) {
		List<String> actions = new ArrayList<>(pendingActions);
		pendingActions.clear();
		skillCheck(now).ifPresent(actions::add);

		boolean interact;
		int dx = 0;
		int dy = 0;
		if (pressPending) {
			// A press is a rising edge: release first if the key was held last tick.
			interact = !interactWasHeld;
			pressPending = interactWasHeld;
		}
		else if (intent.holdInteract()) {
			interact = true;
		}
		else {
			interact = false;
			int[] direction = navigator.direction(now.self().position());
			dx = direction[0];
			dy = direction[1];
		}
		interactWasHeld = interact;
		return new PlayerInput(++seq, dx, dy, intent.sprint(), interact, actions);
	}

	/** Hits a pending skill check at a human-like moment with the difficulty's accuracy. */
	private Optional<String> skillCheck(Perception now) {
		Perception.Self self = now.self();
		if (!self.skillCheckPending()) {
			return Optional.empty();
		}
		if (handledSkillCheckStart != self.skillCheckStartTick()) {
			handledSkillCheckStart = self.skillCheckStartTick();
			boolean success = random.nextDouble() < difficulty.skillCheckAccuracy;
			int window = self.skillCheckDeadlineTick() - self.skillCheckStartTick();
			skillCheckPressTick = success
					? self.skillCheckStartTick() + random.nextInt(Math.max(1, window))
					: self.skillCheckStartTick() - 1 - random.nextInt(3); // too early
		}
		// Matches Match.tick(): the action is applied on the next tick.
		return now.tick() + 1 == skillCheckPressTick ? Optional.of(PlayerInput.SKILL_CHECK)
				: Optional.empty();
	}

	private static Perception withCurrentSelf(Perception delayed, Perception now) {
		return new Perception(now.tick(), now.map(), now.self(), delayed.actors(), delayed.generators(), delayed.sounds(),
				delayed.trails(), delayed.traps(), now.lockers(), now.gates(), now.gateOpen(), delayed.terror());
	}
}
