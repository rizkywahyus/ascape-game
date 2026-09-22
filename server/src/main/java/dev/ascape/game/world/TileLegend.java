package dev.ascape.game.world;

import java.util.Map;
import java.util.Optional;

public final class TileLegend {

	private final Map<Character, TileType> typeByChar;

	public TileLegend(Map<Character, TileType> typeByChar) {
		this.typeByChar = Map.copyOf(typeByChar);
	}

	public Optional<TileType> typeOf(char mapChar) {
		return Optional.ofNullable(typeByChar.get(mapChar));
	}
}
