package dev.ascape.game.match;

import java.util.Locale;

public enum Role {
	SURVIVOR, MONSTER;

	public String wireName() {
		return name().toLowerCase(Locale.ROOT);
	}
}
