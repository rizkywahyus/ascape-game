package dev.ascape.game.world;

import java.util.BitSet;

/**
 * Field of view on the grid: a cell is visible if it is within a circular radius and the Bresenham line from the
 * viewer to it crosses no opaque cell (the target itself may be opaque, so walls are seen).
 * The client's lighting uses the same algorithm (lineOfSight.ts), so what you see lit is what the server lets you see.
 */
public final class LineOfSight {

	private LineOfSight() {
	}

	/** Cells visible from {@code origin} within {@code radius}, as a bitset indexed by {@code y * width + x}. */
	public static BitSet visibleCells(TileMap map, GridPos origin, int radius) {
		BitSet visible = new BitSet(map.width() * map.height());
		int radiusSquared = radius * radius;
		for (int y = Math.max(0, origin.y() - radius); y <= Math.min(map.height() - 1, origin.y() + radius); y++) {
			for (int x = Math.max(0, origin.x() - radius); x <= Math.min(map.width() - 1, origin.x() + radius); x++) {
				int dx = x - origin.x();
				int dy = y - origin.y();
				if (dx * dx + dy * dy <= radiusSquared && isClear(map, origin, new GridPos(x, y))) {
					visible.set(y * map.width() + x);
				}
			}
		}
		return visible;
	}

	/** True if nothing opaque lies strictly between {@code from} and {@code to}. */
	public static boolean isClear(TileMap map, GridPos from, GridPos to) {
		int x = from.x();
		int y = from.y();
		int dx = Math.abs(to.x() - x);
		int dy = -Math.abs(to.y() - y);
		int stepX = x < to.x() ? 1 : -1;
		int stepY = y < to.y() ? 1 : -1;
		int error = dx + dy;
		while (x != to.x() || y != to.y()) {
			int doubled = 2 * error;
			if (doubled >= dy) {
				error += dy;
				x += stepX;
			}
			if (doubled <= dx) {
				error += dx;
				y += stepY;
			}
			if ((x != to.x() || y != to.y()) && map.isOpaque(x, y)) {
				return false;
			}
		}
		return true;
	}

	public static int distanceSquared(GridPos a, GridPos b) {
		int dx = a.x() - b.x();
		int dy = a.y() - b.y();
		return dx * dx + dy * dy;
	}
}
