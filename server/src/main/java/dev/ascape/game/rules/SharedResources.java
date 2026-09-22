package dev.ascape.game.rules;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import dev.ascape.config.AscapeProperties;
import dev.ascape.game.bot.Difficulty;
import dev.ascape.game.world.TileLegend;
import dev.ascape.game.world.TileMap;
import dev.ascape.game.world.TileType;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Loads files from the repo's {@code shared/} directory, packaged on the classpath at build time. */
@Configuration
public class SharedResources {

	private static final String RULES_PATH = "shared/rules.json";
	private static final String TILE_LEGEND_PATH = "shared/maps/tiles.json";
	private static final String MAP_PATH_FORMAT = "shared/maps/%s.map.txt";

	@Bean
	GameRules gameRules(JsonMapper jsonMapper, AscapeProperties properties) {
		GameRules rules = jsonMapper.readValue(readClasspath(RULES_PATH), GameRules.class);
		Double countdown = properties.debug().lobbyCountdownSeconds();
		return countdown == null ? rules : rules.withLobbyCountdown(countdown);
	}

	@Bean
	TileLegend tileLegend(JsonMapper jsonMapper) {
		Map<String, TileType> byString = jsonMapper.readValue(readClasspath(TILE_LEGEND_PATH),
				new TypeReference<Map<String, TileType>>() {
				});
		Map<Character, TileType> byChar = new HashMap<>();
		byString.forEach((key, type) -> {
			if (key.length() != 1) {
				throw new IllegalStateException("Tile legend key must be one character: '" + key + "'");
			}
			byChar.put(key.charAt(0), type);
		});
		return new TileLegend(byChar);
	}

	@Bean
	Difficulty botDifficulty(@Value("${ascape.bots.difficulty:normal}") String difficulty) {
		return Difficulty.valueOf(difficulty.strip().toUpperCase(Locale.ROOT));
	}

	@Bean
	TileMap tileMap(AscapeProperties properties, TileLegend legend) {
		String mapId = properties.mapId();
		return TileMap.parse(mapId, readClasspath(MAP_PATH_FORMAT.formatted(mapId)), legend);
	}

	static String readClasspath(String path) {
		try (InputStream input = SharedResources.class.getClassLoader().getResourceAsStream(path)) {
			if (input == null) {
				throw new IllegalStateException("Missing classpath resource " + path);
			}
			return new String(input.readAllBytes(), StandardCharsets.UTF_8);
		}
		catch (IOException e) {
			throw new UncheckedIOException("Failed to read " + path, e);
		}
	}
}
