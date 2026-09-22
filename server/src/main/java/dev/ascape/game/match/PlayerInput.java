package dev.ascape.game.match;

import java.util.List;
import java.util.Set;

/** One tick of intent. Humans and bots produce the same type, so the simulation cannot tell them apart. */
public record PlayerInput(long seq, int dx, int dy, boolean sprint, boolean interact, List<String> actions) {

	public static final String ATTACK = "attack";
	public static final String FLASHLIGHT = "flashlight";
	public static final String THROW = "throw";
	public static final String LUNGE = "ability:lunge";
	public static final String SONAR = "ability:sonar";
	public static final String TRAP = "ability:trap";
	public static final String SKILL_CHECK = "skillcheck";

	public static final Set<String> KNOWN_ACTIONS = Set.of(ATTACK, FLASHLIGHT, THROW, LUNGE, SONAR, TRAP, SKILL_CHECK);
	private static final int MAX_ACTIONS = 4;

	public PlayerInput {
		dx = Integer.signum(dx);
		dy = Integer.signum(dy);
		actions = actions == null ? List.of()
				: actions.stream().filter(KNOWN_ACTIONS::contains).distinct().limit(MAX_ACTIONS).toList();
	}

	public boolean moving() {
		return dx != 0 || dy != 0;
	}

	public boolean has(String action) {
		return actions.contains(action);
	}
}
