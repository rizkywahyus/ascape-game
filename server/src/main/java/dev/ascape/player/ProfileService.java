package dev.ascape.player;

import java.util.Locale;
import java.util.UUID;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;

/** Finds or creates the profile behind a verified Supabase token. */
@Service
public class ProfileService {

	private static final String GUEST_PREFIX = "guest-";
	private static final int GUEST_ID_CHARS = 4;
	private static final int MAX_USERNAME_LENGTH = 24;

	private final PlayerStore store;

	public ProfileService(PlayerStore store) {
		this.store = store;
	}

	public Profile profileFor(Jwt jwt) {
		UUID userId = UUID.fromString(jwt.getSubject());
		return store.findProfile(userId).orElseGet(() -> store.createProfile(userId, suggestedUsername(jwt, userId)));
	}

	public Profile update(Jwt jwt, String username, String glyph, String color) {
		profileFor(jwt);
		return store.updateProfile(UUID.fromString(jwt.getSubject()), username, glyph, color);
	}

	/** Email local part when it makes a valid username, else guest-xxxx (anonymous sign-ins have no email). */
	static String suggestedUsername(Jwt jwt, UUID userId) {
		String email = jwt.getClaimAsString("email");
		if (email != null && email.contains("@")) {
			String local = email.substring(0, email.indexOf('@')).replaceAll("[^A-Za-z0-9_-]", "")
					.toLowerCase(Locale.ROOT);
			local = local.substring(0, Math.min(local.length(), MAX_USERNAME_LENGTH));
			if (ProfileRules.isValidUsername(local)) {
				return local;
			}
		}
		return GUEST_PREFIX + userId.toString().replace("-", "").substring(0, GUEST_ID_CHARS);
	}
}
