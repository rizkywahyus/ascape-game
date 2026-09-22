package dev.ascape.config;

import dev.ascape.auth.TokenHandshakeInterceptor;
import dev.ascape.net.GameWebSocketHandler;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

	public static final String GAME_ENDPOINT = "/ws";
	private static final int MAX_INBOUND_MESSAGE_BYTES = 4 * 1024;
	/** Clients ping every 2 s; a much longer silence means the connection is dead. */
	private static final long MAX_IDLE_MILLIS = 30_000;

	private final GameWebSocketHandler handler;
	private final TokenHandshakeInterceptor tokenInterceptor;
	private final AscapeProperties properties;

	public WebSocketConfig(GameWebSocketHandler handler, TokenHandshakeInterceptor tokenInterceptor,
			AscapeProperties properties) {
		this.handler = handler;
		this.tokenInterceptor = tokenInterceptor;
		this.properties = properties;
	}

	@Override
	public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
		registry.addHandler(handler, GAME_ENDPOINT)
				.addInterceptors(tokenInterceptor)
				.setAllowedOrigins(properties.allowedOrigins().toArray(String[]::new));
	}

	@Bean
	ServletServerContainerFactoryBean webSocketContainer() {
		ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
		container.setMaxTextMessageBufferSize(MAX_INBOUND_MESSAGE_BYTES);
		container.setMaxSessionIdleTimeout(MAX_IDLE_MILLIS);
		return container;
	}
}
