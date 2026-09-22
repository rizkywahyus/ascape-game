package dev.ascape.net.protocol;

/** A server → client message; {@link #type()} becomes the envelope's {@code t}, the record itself its {@code d}. */
public sealed interface ServerMessage permits ServerMessages.Welcome, ServerMessages.Lobby, ServerMessages.MatchStatus,
		ServerMessages.Snapshot, ServerMessages.Event, ServerMessages.Result, ServerMessages.Takeover,
		ServerMessages.Chat, ServerMessages.Pong, ServerMessages.Error {

	String type();
}
