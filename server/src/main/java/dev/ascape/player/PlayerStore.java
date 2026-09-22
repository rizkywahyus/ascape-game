package dev.ascape.player;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Persistent player data. Reads may block (call them off the room thread, e.g. during the WebSocket
 * handshake or in REST handlers); {@link #recordJoin} and {@link #saveMatch} never block.
 */
public interface PlayerStore {

	Optional<Profile> findProfile(UUID userId);

	/** Creates a profile with {@code preferredUsername}, adding a suffix if the name is taken. */
	Profile createProfile(UUID userId, String preferredUsername);

	/**
	 * Updates the given (non-null) fields.
	 * @throws UsernameTakenException if {@code username} belongs to someone else
	 */
	Profile updateProfile(UUID userId, String username, String glyph, String color);

	void recordJoin(UUID userId, String roomId);

	void saveMatch(MatchRecord match);

	List<LeaderboardEntry> leaderboard(LeaderboardKind kind, int limit);

	/** Ranking order: overall score, monster wins or survivor escapes. */
	enum LeaderboardKind {
		OVERALL, MONSTER, SURVIVOR
	}

	class UsernameTakenException extends RuntimeException {

		public UsernameTakenException(String username) {
			super("Username '" + username + "' is taken");
		}
	}
}
