package dev.ascape.game.bot;

import java.util.List;

/**
 * A bot's decision for the next few ticks. Movement comes from the {@link Navigator} unless {@code holdInteract}
 * (channel in place: repair, revive). {@code pressInteract} is a single press (locker, catch).
 */
record Intent(boolean sprint, boolean holdInteract, boolean pressInteract, List<String> actions) {

	static final Intent MOVE = new Intent(false, false, false, List.of());

	static Intent move(boolean sprint, List<String> actions) {
		return new Intent(sprint, false, false, actions);
	}

	static Intent hold(List<String> actions) {
		return new Intent(false, true, false, actions);
	}

	static Intent press() {
		return new Intent(false, false, true, List.of());
	}
}
