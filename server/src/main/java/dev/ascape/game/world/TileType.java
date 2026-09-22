package dev.ascape.game.world;

/**
 * One entry of {@code shared/maps/tiles.json}. {@code opaque} tiles block line of sight;
 * glyph and colour are only used by the client.
 */
public record TileType(TileKind kind, boolean solid, boolean opaque, String glyph, String color) {
}
