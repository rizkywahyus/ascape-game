package dev.ascape.game.match;

import java.util.Locale;

/** Survivor condition. The monster stays {@link #HEALTHY}. */
public enum Health {
	HEALTHY, INJURED, DOWNED, CAUGHT, ESCAPED;

	/** Can walk, repair, revive, hide. */
	public boolean isActive() {
		return this == HEALTHY || this == INJURED;
	}

	/** Still on the map (not caught or escaped). */
	public boolean isInPlay() {
		return this != CAUGHT && this != ESCAPED;
	}

	public String wireName() {
		return name().toLowerCase(Locale.ROOT);
	}
}
