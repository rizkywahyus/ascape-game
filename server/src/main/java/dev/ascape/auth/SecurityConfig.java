package dev.ascape.auth;

import java.util.List;

import dev.ascape.config.AscapeProperties;
import dev.ascape.config.WebSocketConfig;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Stateless bearer-token security. The WebSocket upgrade is permitted here and authenticated by
 * {@link TokenHandshakeInterceptor} instead, because browsers cannot send an Authorization header on it.
 */
@Configuration
public class SecurityConfig {

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
		return http
				.csrf(csrf -> csrf.disable()) // no cookies: tokens travel in headers, so CSRF does not apply
				.cors(Customizer.withDefaults())
				.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(auth -> auth
						.requestMatchers(WebSocketConfig.GAME_ENDPOINT).permitAll()
						.requestMatchers(HttpMethod.GET, "/api/rooms", "/api/leaderboard").permitAll()
						.requestMatchers("/api/**").authenticated()
						.requestMatchers("/actuator/health/**", "/actuator/info", "/actuator/prometheus").permitAll()
						.anyRequest().denyAll())
				.oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()))
				.build();
	}

	@Bean
	CorsConfigurationSource corsConfigurationSource(AscapeProperties properties) {
		CorsConfiguration api = new CorsConfiguration();
		api.setAllowedOrigins(properties.allowedOrigins());
		api.setAllowedMethods(List.of("GET", "PATCH"));
		api.setAllowedHeaders(List.of("Authorization", "Content-Type"));
		UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
		source.registerCorsConfiguration("/api/**", api);
		return source;
	}
}
