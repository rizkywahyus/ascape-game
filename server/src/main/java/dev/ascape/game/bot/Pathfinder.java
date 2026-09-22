package dev.ascape.game.bot;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.Deque;
import java.util.List;
import java.util.PriorityQueue;
import java.util.function.Predicate;

import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Walkability;

/**
 * A* on the grid with king moves (cost 1, Chebyshev heuristic). Diagonal steps follow the same rule as
 * {@link dev.ascape.game.world.Movement#tryStep}: the target must be walkable and at least one of the two
 * orthogonal neighbours free, so every planned step is one the movement code will actually take.
 */
public final class Pathfinder {

	private static final int[][] DIRECTIONS = { { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 }, { 1, 1 }, { 1, -1 },
			{ -1, 1 }, { -1, -1 } };
	/** Diagonals cost slightly more so straight corridors are preferred when lengths tie. */
	private static final double DIAGONAL_TIE_BREAK = 0.001;

	private final int width;
	private final int height;

	public Pathfinder(int width, int height) {
		this.width = width;
		this.height = height;
	}

	/** Shortest path from {@code start} to {@code goal}, excluding {@code start}; empty if unreachable or equal. */
	public List<GridPos> find(Walkability walkability, GridPos start, GridPos goal) {
		return find(walkability, start, cell -> cell.equals(goal), goal);
	}

	/** Shortest path to the nearest cell satisfying {@code isGoal}; {@code hint} steers the heuristic. */
	public List<GridPos> find(Walkability walkability, GridPos start, Predicate<GridPos> isGoal, GridPos hint) {
		if (isGoal.test(start)) {
			return List.of();
		}
		double[] cost = new double[width * height];
		int[] cameFrom = new int[width * height];
		Arrays.fill(cost, Double.POSITIVE_INFINITY);
		Arrays.fill(cameFrom, -1);
		record Node(int index, double priority) {
		}
		PriorityQueue<Node> open = new PriorityQueue<>((a, b) -> Double.compare(a.priority(), b.priority()));
		int startIndex = index(start);
		cost[startIndex] = 0;
		open.add(new Node(startIndex, heuristic(start, hint)));

		while (!open.isEmpty()) {
			Node node = open.poll();
			GridPos current = position(node.index());
			if (isGoal.test(current)) {
				return reconstruct(cameFrom, node.index(), startIndex);
			}
			for (int[] direction : DIRECTIONS) {
				int dx = direction[0];
				int dy = direction[1];
				GridPos next = current.plus(dx, dy);
				if (!canStep(walkability, current, dx, dy)) {
					continue;
				}
				int nextIndex = index(next);
				double stepCost = 1 + (dx != 0 && dy != 0 ? DIAGONAL_TIE_BREAK : 0);
				double candidate = cost[node.index()] + stepCost;
				if (candidate < cost[nextIndex]) {
					cost[nextIndex] = candidate;
					cameFrom[nextIndex] = node.index();
					open.add(new Node(nextIndex, candidate + heuristic(next, hint)));
				}
			}
		}
		return List.of();
	}

	private boolean canStep(Walkability walkability, GridPos from, int dx, int dy) {
		int x = from.x() + dx;
		int y = from.y() + dy;
		if (x < 0 || y < 0 || x >= width || y >= height || !walkability.isWalkable(x, y)) {
			return false;
		}
		if (dx != 0 && dy != 0) {
			return walkability.isWalkable(from.x() + dx, from.y()) || walkability.isWalkable(from.x(), from.y() + dy);
		}
		return true;
	}

	private List<GridPos> reconstruct(int[] cameFrom, int goalIndex, int startIndex) {
		Deque<GridPos> path = new ArrayDeque<>();
		for (int index = goalIndex; index != startIndex; index = cameFrom[index]) {
			path.addFirst(position(index));
		}
		return List.copyOf(path);
	}

	private static double heuristic(GridPos from, GridPos to) {
		return from.chebyshevDistance(to);
	}

	private int index(GridPos pos) {
		return pos.y() * width + pos.x();
	}

	private GridPos position(int index) {
		return new GridPos(index % width, index / width);
	}
}
