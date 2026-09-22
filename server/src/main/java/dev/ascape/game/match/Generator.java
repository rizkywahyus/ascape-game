package dev.ascape.game.match;

import java.util.List;

import dev.ascape.game.world.GridPos;

/** A repairable generator: the {@code G} cell plus its {@code [ ]} frame. */
public final class Generator {

	final int id;
	final GridPos position;
	final List<GridPos> footprint;
	double progress;
	boolean done;
	int nextNoiseTick;

	Generator(int id, GridPos position, List<GridPos> footprint) {
		this.id = id;
		this.position = position;
		this.footprint = List.copyOf(footprint);
	}

	public int id() {
		return id;
	}

	public GridPos position() {
		return position;
	}

	public double progress() {
		return progress;
	}

	public boolean done() {
		return done;
	}

	/** Within reach: king-move distance 1 from any footprint cell. */
	public boolean isAdjacent(GridPos pos) {
		return footprint.stream().anyMatch(cell -> cell.chebyshevDistance(pos) <= 1);
	}
}
