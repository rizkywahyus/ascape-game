package dev.ascape.game.world;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/** Loads the real maps and tile legend from the repo's shared/ directory. */
public final class SharedMaps {

	private static final Path SHARED = Path.of("../shared");

	private SharedMaps() {
	}

	public static TileLegend legend() {
		Map<String, TileType> raw = JsonMapper.builder().build().readValue(SHARED.resolve("maps/tiles.json").toFile(),
				new TypeReference<Map<String, TileType>>() {
				});
		Map<Character, TileType> byChar = new HashMap<>();
		raw.forEach((key, type) -> byChar.put(key.charAt(0), type));
		return new TileLegend(byChar);
	}

	public static TileMap load(String id) {
		try {
			return TileMap.parse(id, Files.readString(SHARED.resolve("maps/" + id + ".map.txt")), legend());
		}
		catch (IOException e) {
			throw new IllegalStateException(e);
		}
	}
}
