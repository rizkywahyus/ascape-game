package dev.ascape.game.room;

import java.util.Locale;
import java.util.Optional;

import dev.ascape.game.match.Role;

/** Which role a player would like; bots fill whatever is left. */
public enum RolePreference {
	MONSTER, SURVIVOR, ANY;

	public static Optional<RolePreference> parse(String value) {
		if (value == null) {
			return Optional.of(ANY);
		}
		return switch (value) {
			case "monster" -> Optional.of(MONSTER);
			case "survivor" -> Optional.of(SURVIVOR);
			case "any" -> Optional.of(ANY);
			default -> Optional.empty();
		};
	}

	public boolean accepts(Role role) {
		return this == ANY || (this == MONSTER) == (role == Role.MONSTER);
	}

	public String wireName() {
		return name().toLowerCase(Locale.ROOT);
	}
}
