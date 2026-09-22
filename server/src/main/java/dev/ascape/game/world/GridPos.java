package dev.ascape.game.world;

public record GridPos(int x, int y) {

	public GridPos plus(int dx, int dy) {
		return new GridPos(x + dx, y + dy);
	}

	/** King-move distance: number of steps with diagonals allowed. */
	public int chebyshevDistance(GridPos other) {
		return Math.max(Math.abs(x - other.x), Math.abs(y - other.y));
	}
}
