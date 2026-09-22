package dev.ascape.api;

import dev.ascape.player.Profile;
import dev.ascape.player.ProfileRules;
import dev.ascape.player.ProfileService;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** The signed-in player's profile; created on first access. */
@RestController
@RequestMapping("/api/me")
public class MeController {

	/** Fields to change; null means "leave as is". */
	public record ProfileUpdate(String username, String glyph, String color) {
	}

	private final ProfileService profiles;

	public MeController(ProfileService profiles) {
		this.profiles = profiles;
	}

	@GetMapping
	public Profile me(@AuthenticationPrincipal Jwt jwt) {
		return profiles.profileFor(jwt);
	}

	@PatchMapping
	public Profile update(@AuthenticationPrincipal Jwt jwt, @RequestBody ProfileUpdate update) {
		if (update.username() != null && !ProfileRules.isValidUsername(update.username())) {
			throw badRequest("username must be 3-24 characters: letters, digits, _ or -");
		}
		if (update.glyph() != null && !ProfileRules.isValidGlyph(update.glyph())) {
			throw badRequest("glyph must be one printable ASCII character not used by the map or monster");
		}
		if (update.color() != null && !ProfileRules.isValidColor(update.color())) {
			throw badRequest("color must be #rrggbb and bright enough to read on a dark background");
		}
		return profiles.update(jwt, update.username(), update.glyph(), update.color());
	}

	private static ResponseStatusException badRequest(String reason) {
		return new ResponseStatusException(HttpStatus.BAD_REQUEST, reason);
	}
}
