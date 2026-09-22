package dev.ascape.game.room;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import dev.ascape.game.match.PlayerInput;

/**
 * A human's inputs waiting for the room, consumed one per tick.
 * <p>
 * The client sends one input per tick, so once a burst (a browser hitch, a network clump) builds a backlog, it would
 * never drain and every press would stay late. The queue therefore keeps at most {@link #MAX_BACKLOG} inputs;
 * older ones are dropped, but their one-shot actions (attack, flashlight…) and a held interact are carried into the
 * next input, so a press is never lost, only its stale movement.
 */
final class InputQueue {

	static final int MAX_BACKLOG = 3;

	private final Deque<PlayerInput> pending = new ArrayDeque<>();
	private long lastAppliedSeq;

	long lastAppliedSeq() {
		return lastAppliedSeq;
	}

	int size() {
		return pending.size();
	}

	void add(PlayerInput input) {
		boolean stale = input.seq() <= lastAppliedSeq
				|| (!pending.isEmpty() && input.seq() <= pending.peekLast().seq());
		if (stale) {
			return;
		}
		pending.addLast(input);
		while (pending.size() > MAX_BACKLOG) {
			PlayerInput dropped = pending.removeFirst();
			pending.addFirst(mergeInto(pending.removeFirst(), dropped));
		}
	}

	/** The input for this tick, or null when none arrived (the character is then not simulated). */
	PlayerInput poll() {
		PlayerInput next = pending.pollFirst();
		if (next != null) {
			lastAppliedSeq = next.seq();
		}
		return next;
	}

	private static PlayerInput mergeInto(PlayerInput keep, PlayerInput dropped) {
		List<String> actions = new ArrayList<>(dropped.actions());
		keep.actions().stream().filter(action -> !actions.contains(action)).forEach(actions::add);
		long viewTick = dropped.actions().isEmpty() ? keep.viewTick() : dropped.viewTick();
		return new PlayerInput(keep.seq(), keep.dx(), keep.dy(), keep.sprint(), keep.interact() || dropped.interact(),
				actions, viewTick);
	}
}
