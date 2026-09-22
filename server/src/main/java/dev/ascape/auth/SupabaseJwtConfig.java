package dev.ascape.auth;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

/**
 * Verifies Supabase access tokens: signature via the project's JWKS (asymmetric ES256/RS256 signing keys,
 * cached by Nimbus), issuer, expiry and the {@code authenticated} audience.
 * Projects still on the legacy shared HS256 secret are not supported.
 */
@Configuration
public class SupabaseJwtConfig {

	private static final Logger log = LoggerFactory.getLogger(SupabaseJwtConfig.class);
	private static final String AUDIENCE = "authenticated";

	@Bean
	JwtDecoder jwtDecoder(AuthProperties properties) {
		if (!properties.supabaseConfigured()) {
			log.warn("ascape.auth.supabase-url is not set: every access token will be rejected");
			return token -> {
				throw new BadJwtException("Supabase auth is not configured");
			};
		}
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(properties.jwkSetUri())
				.jwsAlgorithms(algorithms -> {
					algorithms.add(SignatureAlgorithm.ES256);
					algorithms.add(SignatureAlgorithm.RS256);
				})
				.build();
		OAuth2TokenValidator<Jwt> audience = new JwtClaimValidator<List<String>>("aud",
				aud -> aud != null && aud.contains(AUDIENCE));
		decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
				JwtValidators.createDefaultWithIssuer(properties.issuer()), audience));
		return decoder;
	}
}
