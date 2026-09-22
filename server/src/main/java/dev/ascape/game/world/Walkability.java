package dev.ascape.game.world;

/** Whether a character may stand on a cell right now (static map plus dynamic state such as an open gate). */
@FunctionalInterface
public interface Walkability {

	boolean isWalkable(int x, int y);
}
