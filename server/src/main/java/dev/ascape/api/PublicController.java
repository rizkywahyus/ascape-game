package dev.ascape.api;

import java.util.List;

import dev.ascape.game.room.RoomManager;
import dev.ascape.player.LeaderboardEntry;
import dev.ascape.player.PlayerStore;
import dev.ascape.player.PlayerStore.LeaderboardKind;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Endpoints that need no sign-in. */
@RestController
@RequestMapping("/api")
public class PublicController {

	private static final int MAX_LEADERBOARD_SIZE = 100;

	public record RoomSummary(String id, int players) {
	}

	private final RoomManager rooms;
	private final PlayerStore players;

	public PublicController(RoomManager rooms, PlayerStore players) {
		this.rooms = rooms;
		this.players = players;
	}

	@GetMapping("/rooms")
	public List<RoomSummary> rooms() {
		return rooms.rooms().stream().map(room -> new RoomSummary(room.id(), room.playerCount())).toList();
	}

	@GetMapping("/leaderboard")
	public List<LeaderboardEntry> leaderboard(@RequestParam(defaultValue = "overall") String kind,
			@RequestParam(defaultValue = "20") int limit) {
		LeaderboardKind parsed = switch (kind) {
			case "monster" -> LeaderboardKind.MONSTER;
			case "survivor" -> LeaderboardKind.SURVIVOR;
			default -> LeaderboardKind.OVERALL;
		};
		return players.leaderboard(parsed, Math.clamp(limit, 1, MAX_LEADERBOARD_SIZE));
	}
}
