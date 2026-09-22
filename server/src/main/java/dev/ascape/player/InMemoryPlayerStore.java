package dev.ascape.player;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/** {@link PlayerStore} used when no database is configured (local dev, tests). Data is lost on restart. */
public class InMemoryPlayerStore implements PlayerStore {

	private final Map<UUID, Profile> profiles = new ConcurrentHashMap<>();
	private final Map<UUID, LeaderboardEntry> stats = new ConcurrentHashMap<>();

	@Override
	public Optional<Profile> findProfile(UUID userId) {
		return Optional.ofNullable(profiles.get(userId));
	}

	@Override
	public synchronized Profile createProfile(UUID userId, String preferredUsername) {
		Profile existing = profiles.get(userId);
		if (existing != null) {
			return existing;
		}
		String username = preferredUsername;
		for (int suffix = 2; isTaken(username, userId); suffix++) {
			username = preferredUsername + "-" + suffix;
		}
		Profile profile = new Profile(userId, username, ProfileRules.DEFAULT_GLYPH, ProfileRules.DEFAULT_COLOR);
		profiles.put(userId, profile);
		return profile;
	}

	@Override
	public synchronized Profile updateProfile(UUID userId, String username, String glyph, String color) {
		Profile current = findProfile(userId).orElseThrow(() -> new IllegalArgumentException("No profile " + userId));
		if (username != null && isTaken(username, userId)) {
			throw new UsernameTakenException(username);
		}
		Profile updated = new Profile(userId,
				username != null ? username : current.username(),
				glyph != null ? glyph : current.glyph(),
				color != null ? color : current.color());
		profiles.put(userId, updated);
		return updated;
	}

	@Override
	public void recordJoin(UUID userId, String roomId) {
		// Nothing worth keeping in memory.
	}

	@Override
	public synchronized void saveMatch(MatchRecord match) {
		for (MatchRecord.Participant p : match.participants()) {
			if (p.userId() == null) {
				continue;
			}
			Profile profile = profiles.get(p.userId());
			if (profile == null) {
				continue;
			}
			boolean monster = "monster".equals(p.role());
			LeaderboardEntry old = stats.getOrDefault(p.userId(),
					new LeaderboardEntry(profile.username(), profile.glyph(), profile.color(), 0, 0, 0, 0, 0));
			stats.put(p.userId(), new LeaderboardEntry(profile.username(), profile.glyph(), profile.color(),
					old.matches() + 1, old.wins() + (p.won() ? 1 : 0), old.score() + p.score(),
					old.monsterWins() + (monster && p.won() ? 1 : 0),
					old.survivorEscapes() + (!monster && p.escaped() ? 1 : 0)));
		}
	}

	@Override
	public List<LeaderboardEntry> leaderboard(LeaderboardKind kind, int limit) {
		Comparator<LeaderboardEntry> order = switch (kind) {
			case OVERALL -> Comparator.comparingLong(LeaderboardEntry::score);
			case MONSTER -> Comparator.comparingInt(LeaderboardEntry::monsterWins);
			case SURVIVOR -> Comparator.comparingInt(LeaderboardEntry::survivorEscapes);
		};
		return stats.values().stream().sorted(order.reversed()).limit(limit).toList();
	}

	private boolean isTaken(String username, UUID exceptUserId) {
		return profiles.values().stream()
				.anyMatch(p -> p.username().equalsIgnoreCase(username) && !p.id().equals(exceptUserId));
	}
}
