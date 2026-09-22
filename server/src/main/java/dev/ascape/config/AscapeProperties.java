package dev.ascape.config;

import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param allowedOrigins browser origins allowed to open the game WebSocket
 * @param mapId          map loaded for new rooms, from classpath {@code shared/maps/<mapId>.map.txt}
 * @param debug          development aids; keep disabled in production
 */
@ConfigurationProperties("ascape")
public record AscapeProperties(List<String> allowedOrigins, String mapId, Debug debug) {

	/**
	 * @param simulatedLatencyMs    extra one-way delay applied to every inbound and outbound message
	 *                              (round trip grows by twice this), to demo prediction and interpolation
	 * @param lobbyCountdownSeconds overrides the lobby countdown from rules.json (null keeps it), for quick tests
	 * @param botView               send every bot's state and planned path to all clients (reveals positions!)
	 */
	public record Debug(int simulatedLatencyMs, Double lobbyCountdownSeconds, boolean botView) {

		public Debug {
			if (simulatedLatencyMs < 0) {
				throw new IllegalArgumentException("simulatedLatencyMs must be >= 0");
			}
		}
	}

	public AscapeProperties {
		allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
		if (mapId == null || mapId.isBlank()) {
			mapId = "manor";
		}
		if (debug == null) {
			debug = new Debug(0, null, false);
		}
	}
}
