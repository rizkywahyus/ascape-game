package dev.ascape.game.room;

import dev.ascape.net.ClientConnection;
import dev.ascape.net.protocol.ClientMessages.Input;

/** Work handed from network threads to a room; applied on the room thread at the start of a tick. */
sealed interface RoomCommand {

	record Join(ClientConnection connection, RolePreference rolePref) implements RoomCommand {
	}

	/** {@code keepSeat}: a dropped connection may reclaim its character; someone who left on purpose may not. */
	record Leave(ClientConnection connection, boolean keepSeat) implements RoomCommand {
	}

	record ApplyInput(ClientConnection connection, Input input) implements RoomCommand {
	}

	record Chat(ClientConnection connection, String text) implements RoomCommand {
	}

	record Hold(ClientConnection connection, boolean hold) implements RoomCommand {
	}
}
