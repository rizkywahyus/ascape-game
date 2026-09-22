package dev.ascape.net.protocol;

import java.util.List;

/** Client → server payloads, as decoded from the envelope's {@code d}. Validate before use. */
public final class ClientMessages {

	private ClientMessages() {
	}

	public sealed interface ClientMessage permits Queue, Join, Leave, Input, ChatSend, Ping {
	}

	/** Matchmaking: find (or create) a room. {@code rolePref} is monster, survivor or any. */
	public record Queue(String rolePref) implements ClientMessage {
	}

	/** Join a specific room by id (private games, spectating). */
	public record Join(String roomId, String rolePref) implements ClientMessage {
	}

	public record Leave() implements ClientMessage {
	}

	/** {@code viewTick}: snapshot tick the client showed other characters at (optional), for lag compensation. */
	public record Input(long seq, int dx, int dy, boolean sprint, boolean interact, List<String> actions, Long viewTick)
			implements ClientMessage {

		public Input {
			actions = actions == null ? List.of() : List.copyOf(actions);
			viewTick = viewTick == null || viewTick < 0 ? 0L : viewTick;
		}
	}

	public record ChatSend(String text) implements ClientMessage {
	}

	public record Ping(long ts) implements ClientMessage {
	}
}
