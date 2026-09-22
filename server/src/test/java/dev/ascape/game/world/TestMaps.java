package dev.ascape.game.world;

import java.util.Map;

/** Builds maps from inline ASCII using the real legend's solidity rules. */
public final class TestMaps {

	public static final TileLegend LEGEND = new TileLegend(Map.of(
			'#', new TileType(TileKind.WALL, true, true, "█", "#000"),
			'.', new TileType(TileKind.FLOOR, false, false, "·", "#000"),
			'S', new TileType(TileKind.SURVIVOR_SPAWN, false, false, "·", "#000"),
			'M', new TileType(TileKind.MONSTER_SPAWN, false, false, "·", "#000"),
			'E', new TileType(TileKind.GATE, true, true, "▓", "#000"),
			'[', new TileType(TileKind.GENERATOR_FRAME, true, false, "[", "#000"),
			']', new TileType(TileKind.GENERATOR_FRAME, true, false, "]", "#000"),
			'G', new TileType(TileKind.GENERATOR, true, false, "≡", "#000"),
			'L', new TileType(TileKind.LOCKER, true, false, "▯", "#000")));

	private TestMaps() {
	}

	public static TileMap of(String... rows) {
		return TileMap.parse("test", String.join("\n", rows), LEGEND);
	}

	public static Walkability staticWalkability(TileMap map) {
		return (x, y) -> !map.isSolid(x, y);
	}
}
