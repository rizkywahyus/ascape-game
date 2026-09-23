package dev.ascape.net.protocol;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

/** Server → client payloads. Field names are the wire format; see shared/protocol.md. */
public final class ServerMessages {

	private ServerMessages() {
	}

	public record MapData(String id, List<String> rows) {
	}

	public record Welcome(String playerId, String roomId, int tickRate, long serverTick, MapData map)
			implements ServerMessage {

		@Override
		public String type() {
			return "welcome";
		}
	}

	/** {@code host}: the player who may hold and resume the countdown (the first one in the room). */
	public record LobbySlot(String name, String rolePref, boolean isBot, boolean you, boolean host) {
	}

	/** {@code held}: the countdown is frozen until the host resumes it; players may still join meanwhile. */
	public record Lobby(String roomId, List<LobbySlot> members, int capacity, long startsInMs, boolean held)
			implements ServerMessage {

		@Override
		public String type() {
			return "lobby";
		}
	}

	public record RosterEntry(int entityId, String role, String name, boolean isBot, String health) {
	}

	/** Match status; {@code entityId} is the viewer's own character, or null when spectating. */
	@JsonInclude(JsonInclude.Include.ALWAYS)
	public record MatchStatus(String phase, String role, Integer entityId, Integer spectatingId, int generatorsTotal,
			int generatorsNeeded, int generatorsDone, boolean gateOpen, long timeLeftMs, List<RosterEntry> roster)
			implements ServerMessage {

		@Override
		public String type() {
			return "match";
		}
	}

	public record SkillCheckView(long startsInMs, long windowMs) {
	}

	public record Cooldowns(long attackMs, long lungeMs, long sonarMs, long trapMs) {
	}

	public record SelfState(int id, int x, int y, double moveProgress, String role, String health, boolean hidden,
			boolean canMove, double moveSpeed, double sprintSpeed, double stamina, boolean flashlight, int rocks,
			String activity, double activityProgress, double terror, long bleedOutMs, Cooldowns cooldowns,
			int trapsLeft, boolean sonarActive, boolean lungeActive, double takenProgress, SkillCheckView skillCheck,
			boolean spectating) {
	}

	public record EntityView(int id, String kind, int x, int y, String glyph, String color, String name,
			String health, boolean flashlight, String activity) {
	}

	/** {@code progress} is null when the generator is out of the viewer's sight. */
	@JsonInclude(JsonInclude.Include.ALWAYS)
	public record GeneratorView(int id, int x, int y, Double progress, boolean done) {
	}

	public record CellView(int x, int y) {
	}

	public record TrailView(int x, int y, double age) {
	}

	/** Direction (unit vector) and loudness of a noise; never its exact position. */
	public record SoundView(String kind, double dx, double dy, double intensity) {
	}

	/** Dev-only: a bot's state and planned path (see ascape.debug.bot-view). */
	public record BotDebugView(int id, String state, List<CellView> path) {
	}

	/** {@code bots} is only present when the server runs with the bot debug view enabled. */
	public record Snapshot(long tick, long ackSeq, SelfState you, List<EntityView> entities,
			List<GeneratorView> generators, List<CellView> traps, List<TrailView> trails, List<SoundView> sounds,
			@JsonInclude(JsonInclude.Include.NON_NULL) List<BotDebugView> bots)
			implements ServerMessage {

		@Override
		public String type() {
			return "snapshot";
		}
	}

	/** Match event: {@code kind} plus event-specific fields (see shared/protocol.md). */
	public record Event(String kind, Map<String, Object> data) implements ServerMessage {

		@Override
		public String type() {
			return "event";
		}
	}

	public record PlayerResult(int entityId, String name, String role, boolean isBot, boolean escaped, boolean caught,
			double generators, int hits, int downs, int catches, int revives, int score) {
	}

	public record Result(String winner, List<PlayerResult> players, long nextLobbyInMs) implements ServerMessage {

		@Override
		public String type() {
			return "result";
		}
	}

	public record Takeover(Integer entityId, String reason) implements ServerMessage {

		@Override
		public String type() {
			return "takeover";
		}
	}

	public record Chat(String from, String text, long ts) implements ServerMessage {

		@Override
		public String type() {
			return "chat";
		}
	}

	public record Pong(long ts, long serverTs) implements ServerMessage {

		@Override
		public String type() {
			return "pong";
		}
	}

	public record Error(String code, String msg) implements ServerMessage {

		@Override
		public String type() {
			return "error";
		}
	}
}
