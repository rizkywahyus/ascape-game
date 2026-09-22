package dev.ascape.player;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Outcome of a finished match, persisted asynchronously. {@code userId} is null for bots and guests. */
public record MatchRecord(String roomId, String mapId, Instant startedAt, Instant endedAt, String winner,
		List<Participant> participants) {

	public record Participant(UUID userId, boolean bot, String role, boolean escaped, boolean caught,
			int generatorsRepaired, int hits, int downs, int score, boolean won) {
	}

	public MatchRecord {
		participants = List.copyOf(participants);
	}
}
