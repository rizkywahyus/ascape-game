package dev.ascape.player;

public record LeaderboardEntry(String username, String glyph, String color, int matches, int wins, long score,
		int monsterWins, int survivorEscapes) {
}
