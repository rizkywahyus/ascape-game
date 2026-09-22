package dev.ascape.game.match;

import dev.ascape.game.world.GridPos;

public final class Locker {

	final GridPos position;
	Actor occupant;

	Locker(GridPos position) {
		this.position = position;
	}

	public GridPos position() {
		return position;
	}

	public boolean occupied() {
		return occupant != null;
	}
}
