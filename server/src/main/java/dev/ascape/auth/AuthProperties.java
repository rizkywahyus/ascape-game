package dev.ascape.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param supabaseUrl          project URL; tokens are verified against its JWKS. Blank rejects every token.
 * @param allowUnauthenticated accept WebSocket connections without a token as anonymous guests (dev / load tests)
 */
@ConfigurationProperties("ascape.auth")
public record AuthProperties(String supabaseUrl, boolean allowUnauthenticated) {

	public AuthProperties {
		supabaseUrl = supabaseUrl == null ? "" : supabaseUrl.strip().replaceAll("/+$", "");
	}

	public boolean supabaseConfigured() {
		return !supabaseUrl.isEmpty();
	}

	/** Issuer claim Supabase puts in its access tokens. */
	public String issuer() {
		return supabaseUrl + "/auth/v1";
	}

	public String jwkSetUri() {
		return issuer() + "/.well-known/jwks.json";
	}
}
