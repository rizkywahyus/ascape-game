package dev.ascape.net;

import java.util.UUID;

import dev.ascape.player.Profile;
import dev.ascape.player.ProfileRules;

/**
 * Who is behind a connection. {@code userId} is the Supabase user id, or null for an unauthenticated guest
 * (only allowed when {@code ascape.auth.allow-unauthenticated} is on).
 */
public record PlayerIdentity(String playerId, UUID userId, String displayName, String glyph, String color) {

	private static final int GUEST_SUFFIX_LENGTH = 4;

	public static PlayerIdentity guest(String sessionId) {
		String suffix = sessionId.replace("-", "");
		suffix = suffix.substring(0, Math.min(GUEST_SUFFIX_LENGTH, suffix.length()));
		return new PlayerIdentity("guest:" + sessionId, null, "guest-" + suffix, ProfileRules.DEFAULT_GLYPH,
				ProfileRules.DEFAULT_COLOR);
	}

	public static PlayerIdentity of(Profile profile) {
		return new PlayerIdentity(profile.id().toString(), profile.id(), profile.username(), profile.glyph(),
				profile.color());
	}

	public boolean authenticated() {
		return userId != null;
	}
}
