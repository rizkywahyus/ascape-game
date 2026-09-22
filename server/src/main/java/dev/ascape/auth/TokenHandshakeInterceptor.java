package dev.ascape.auth;

import java.util.Map;

import dev.ascape.net.GameWebSocketHandler;
import dev.ascape.net.PlayerIdentity;
import dev.ascape.player.ProfileService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Authenticates the WebSocket upgrade. Browsers cannot set headers on a WebSocket, so the Supabase access token
 * comes in the {@code token} query parameter. Invalid or expired tokens get 401 and no connection.
 */
@Component
public class TokenHandshakeInterceptor implements HandshakeInterceptor {

	private static final Logger log = LoggerFactory.getLogger(TokenHandshakeInterceptor.class);
	private static final String TOKEN_PARAMETER = "token";

	private final JwtDecoder jwtDecoder;
	private final ProfileService profiles;
	private final AuthProperties properties;

	public TokenHandshakeInterceptor(JwtDecoder jwtDecoder, ProfileService profiles, AuthProperties properties) {
		this.jwtDecoder = jwtDecoder;
		this.profiles = profiles;
		this.properties = properties;
	}

	@Override
	public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
			Map<String, Object> attributes) {
		String token = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams()
				.getFirst(TOKEN_PARAMETER);
		if (token == null || token.isBlank()) {
			if (properties.allowUnauthenticated()) {
				return true; // the handler assigns a guest identity
			}
			response.setStatusCode(HttpStatus.UNAUTHORIZED);
			return false;
		}
		try {
			Jwt jwt = jwtDecoder.decode(token);
			attributes.put(GameWebSocketHandler.IDENTITY_ATTRIBUTE, PlayerIdentity.of(profiles.profileFor(jwt)));
			return true;
		}
		catch (JwtException e) {
			log.debug("Rejected WebSocket token: {}", e.getMessage());
			response.setStatusCode(HttpStatus.UNAUTHORIZED);
			return false;
		}
		catch (DataAccessException e) {
			log.error("Profile lookup failed during WebSocket handshake", e);
			response.setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
			return false;
		}
	}

	@Override
	public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
			Exception exception) {
		// Nothing to clean up.
	}
}
