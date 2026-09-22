package dev.ascape.game.match;

import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Movement.MoveState;

/** Test-only hooks into package-private match state, for tests in other packages. */
public final class MatchTestAccess {

	private MatchTestAccess() {
	}

	public static void place(Actor actor, int x, int y) {
		actor.move = new MoveState(new GridPos(x, y), 1.0);
	}

	public static void setFlashlight(Actor actor, boolean on) {
		actor.flashlightOn = on;
	}
}
