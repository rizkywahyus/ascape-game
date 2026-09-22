package dev.ascape.player;

import java.sql.Timestamp;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;

/** {@link PlayerStore} on the Supabase Postgres tables (see supabase/migrations). */
public class JdbcPlayerStore implements PlayerStore {

	private static final int MAX_USERNAME_ATTEMPTS = 5;
	private static final int USERNAME_SUFFIX_BYTES = 2;
	private static final int MAX_USERNAME_LENGTH = 24;

	private final JdbcClient jdbc;
	private final TransactionTemplate transactions;
	private final PersistenceQueue writes;

	public JdbcPlayerStore(JdbcClient jdbc, TransactionTemplate transactions, PersistenceQueue writes) {
		this.jdbc = jdbc;
		this.transactions = transactions;
		this.writes = writes;
	}

	@Override
	public Optional<Profile> findProfile(UUID userId) {
		return jdbc.sql("select id, username, glyph, color from profiles where id = ?")
				.param(userId)
				.query(Profile.class)
				.optional();
	}

	@Override
	public Profile createProfile(UUID userId, String preferredUsername) {
		String candidate = preferredUsername;
		for (int attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
			try {
				String username = candidate;
				return transactions.execute(status -> {
					jdbc.sql("""
							insert into profiles (id, username, glyph, color) values (?, ?, ?, ?)
							on conflict (id) do nothing""")
							.params(userId, username, ProfileRules.DEFAULT_GLYPH, ProfileRules.DEFAULT_COLOR)
							.update();
					jdbc.sql("insert into player_stats (user_id) values (?) on conflict (user_id) do nothing")
							.param(userId)
							.update();
					return findProfile(userId).orElseThrow();
				});
			}
			catch (DuplicateKeyException usernameTaken) {
				candidate = withRandomSuffix(preferredUsername);
			}
		}
		throw new UsernameTakenException(preferredUsername);
	}

	@Override
	public Profile updateProfile(UUID userId, String username, String glyph, String color) {
		try {
			return jdbc.sql("""
					update profiles set
					  username = coalesce(?, username),
					  glyph = coalesce(?, glyph),
					  color = coalesce(?, color)
					where id = ?
					returning id, username, glyph, color""")
					.params(username, glyph, color, userId)
					.query(Profile.class)
					.single();
		}
		catch (DuplicateKeyException e) {
			throw new UsernameTakenException(username);
		}
	}

	@Override
	public void recordJoin(UUID userId, String roomId) {
		writes.submit("record join", () -> jdbc.sql("""
				update player_stats set last_room = ?, updated_at = now() where user_id = ?""")
				.params(roomId, userId)
				.update());
	}

	@Override
	public void saveMatch(MatchRecord match) {
		writes.submit("save match " + match.roomId(), () -> transactions.executeWithoutResult(status -> {
			UUID matchId = jdbc.sql("""
					insert into matches (room_id, map_id, started_at, ended_at, winner, result)
					values (?, ?, ?, ?, ?, null) returning id""")
					.params(match.roomId(), match.mapId(), Timestamp.from(match.startedAt()),
							Timestamp.from(match.endedAt()), match.winner())
					.query(UUID.class)
					.single();
			for (MatchRecord.Participant p : match.participants()) {
				jdbc.sql("""
						insert into match_players (match_id, user_id, is_bot, role, escaped, caught,
						  generators_repaired, hits, downs, score)
						values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""")
						.params(matchId, p.userId(), p.bot(), p.role(), p.escaped(), p.caught(),
								p.generatorsRepaired(), p.hits(), p.downs(), p.score())
						.update();
				if (p.userId() != null) {
					updateStats(p);
				}
			}
		}));
	}

	private void updateStats(MatchRecord.Participant p) {
		boolean monster = "monster".equals(p.role());
		jdbc.sql("""
				update player_stats set
				  matches = matches + 1,
				  wins = wins + ?,
				  score = score + ?,
				  monster_matches = monster_matches + ?,
				  monster_wins = monster_wins + ?,
				  survivor_matches = survivor_matches + ?,
				  survivor_escapes = survivor_escapes + ?,
				  updated_at = now()
				where user_id = ?""")
				.params(p.won() ? 1 : 0, p.score(),
						monster ? 1 : 0, monster && p.won() ? 1 : 0,
						monster ? 0 : 1, !monster && p.escaped() ? 1 : 0,
						p.userId())
				.update();
	}

	@Override
	public List<LeaderboardEntry> leaderboard(LeaderboardKind kind, int limit) {
		String orderBy = switch (kind) {
			case OVERALL -> "s.score desc, s.wins desc";
			case MONSTER -> "s.monster_wins desc, s.score desc";
			case SURVIVOR -> "s.survivor_escapes desc, s.score desc";
		};
		return jdbc.sql("""
				select p.username, p.glyph, p.color, s.matches, s.wins, s.score, s.monster_wins, s.survivor_escapes
				from player_stats s join profiles p on p.id = s.user_id
				where s.matches > 0
				order by %s
				limit ?""".formatted(orderBy))
				.param(limit)
				.query(LeaderboardEntry.class)
				.list();
	}

	private static String withRandomSuffix(String base) {
		byte[] random = new byte[USERNAME_SUFFIX_BYTES];
		ThreadLocalRandom.current().nextBytes(random);
		String suffix = "-" + HexFormat.of().formatHex(random);
		String trimmed = base.substring(0, Math.min(base.length(), MAX_USERNAME_LENGTH - suffix.length()));
		return trimmed + suffix;
	}
}
