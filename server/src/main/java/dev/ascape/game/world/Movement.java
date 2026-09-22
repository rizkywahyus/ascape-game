package dev.ascape.game.world;

/**
 * Grid movement shared (in behaviour) with the client's {@code movement.ts}; the two must stay identical
 * because the client predicts its own character with it. See shared/protocol.md "World model".
 */
public final class Movement {

	/** Position plus accumulated move progress; one step costs 1.0 progress. */
	public record MoveState(GridPos position, double progress) {
	}

	private static final double STEP_COST = 1.0;

	private Movement() {
	}

	/**
	 * Advances one tick. {@code dx}/{@code dy} must already be clamped to -1..1.
	 * At most one step per tick: speeds are far below the tick rate.
	 */
	public static MoveState advance(Walkability walkability, MoveState state, int dx, int dy, double speed, int tickRate) {
		double progress = state.progress() + speed / tickRate;
		boolean moving = dx != 0 || dy != 0;
		if (!moving || progress < STEP_COST) {
			return new MoveState(state.position(), Math.min(progress, STEP_COST));
		}
		GridPos next = tryStep(walkability, state.position(), dx, dy);
		if (next.equals(state.position())) {
			return new MoveState(next, Math.min(progress, STEP_COST));
		}
		return new MoveState(next, progress - STEP_COST);
	}

	/**
	 * One cell towards (dx, dy) if walkable. A blocked diagonal slides along whichever axis is free;
	 * a diagonal never cuts between two solid orthogonal neighbours.
	 */
	public static GridPos tryStep(Walkability walkability, GridPos from, int dx, int dy) {
		if (dx == 0 && dy == 0) {
			return from;
		}
		boolean horizontalFree = dx != 0 && walkability.isWalkable(from.x() + dx, from.y());
		boolean verticalFree = dy != 0 && walkability.isWalkable(from.x(), from.y() + dy);

		if (dx != 0 && dy != 0
				&& (horizontalFree || verticalFree)
				&& walkability.isWalkable(from.x() + dx, from.y() + dy)) {
			return from.plus(dx, dy);
		}
		if (horizontalFree) {
			return from.plus(dx, 0);
		}
		if (verticalFree) {
			return from.plus(0, dy);
		}
		return from;
	}

	public static int clampAxis(int value) {
		return Integer.signum(value);
	}
}
