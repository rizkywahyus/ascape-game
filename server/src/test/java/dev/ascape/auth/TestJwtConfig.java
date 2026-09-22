package dev.ascape.auth;

import java.time.Instant;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/** Accepts tokens of the form {@code test-<uuid>} so tests can connect as stable, signed-in users. */
@TestConfiguration
public class TestJwtConfig {

	public static final String PREFIX = "test-";

	@Bean
	@Primary
	JwtDecoder testJwtDecoder() {
		return token -> {
			if (!token.startsWith(PREFIX)) {
				throw new BadJwtException("not a test token");
			}
			return Jwt.withTokenValue(token)
					.header("alg", "none")
					.subject(token.substring(PREFIX.length()))
					.issuedAt(Instant.now())
					.expiresAt(Instant.now().plusSeconds(3_600))
					.build();
		};
	}
}
