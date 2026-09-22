package dev.ascape.game.bot;

import java.util.List;
import java.util.function.Predicate;

import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Walkability;

/** Follows an A* path one step at a time; replans when the goal changes, the bot strays, or the plan is old. */
final class Navigator {

	/** Plans older than this are refreshed (doors open, targets move). */
	private static final int REPLAN_TICKS = 40;

	private final Pathfinder pathfinder;
	private List<GridPos> path = List.of();
	private int nextIndex;
	private Object goalKey;
	private int plannedTick = Integer.MIN_VALUE;

	Navigator(Pathfinder pathfinder) {
		this.pathfinder = pathfinder;
	}

	/** Heads for any cell satisfying {@code isGoal}; {@code goalKey} identifies the goal to detect changes. */
	void goTo(Walkability walkability, GridPos from, Object goalKey, Predicate<GridPos> isGoal, GridPos hint, int tick) {
		boolean offPath = nextIndex < path.size() && path.get(nextIndex).chebyshevDistance(from) > 1;
		if (!goalKey.equals(this.goalKey) || offPath || tick - plannedTick > REPLAN_TICKS) {
			path = pathfinder.find(walkability, from, isGoal, hint);
			nextIndex = 0;
			this.goalKey = goalKey;
			plannedTick = tick;
		}
	}

	void goTo(Walkability walkability, GridPos from, GridPos goal, int tick) {
		goTo(walkability, from, goal, goal::equals, goal, tick);
	}

	void stop() {
		path = List.of();
		nextIndex = 0;
		goalKey = null;
	}

	/** Steps still ahead, for the debug view. */
	List<GridPos> remainingPath() {
		return nextIndex >= path.size() ? List.of() : path.subList(nextIndex, path.size());
	}

	boolean arrived() {
		return nextIndex >= path.size();
	}

	/** Direction of the next step from {@code current}, or {0, 0} when there is nowhere to go. */
	int[] direction(GridPos current) {
		while (nextIndex < path.size() && path.get(nextIndex).equals(current)) {
			nextIndex++;
		}
		if (nextIndex >= path.size()) {
			return new int[] { 0, 0 };
		}
		GridPos next = path.get(nextIndex);
		return new int[] { Integer.signum(next.x() - current.x()), Integer.signum(next.y() - current.y()) };
	}
}
