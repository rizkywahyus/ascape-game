package dev.ascape.player;

import java.util.UUID;

/** A registered player's public appearance (table {@code profiles}). */
public record Profile(UUID id, String username, String glyph, String color) {
}
