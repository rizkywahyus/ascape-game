package dev.ascape.game.bot;

import java.util.List;

import dev.ascape.game.match.Health;
import dev.ascape.game.match.Role;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.TileMap;

/**
 * Everything a bot knows this tick, and nothing more than a human in the same seat would: built only from
 * {@link dev.ascape.game.match.Visibility} and the bot's own state (see {@link PerceptionBuilder}). The static
 * {@code map} is public: every client receives it in {@code welcome}.
 */
public record Perception(int tick, TileMap map, Self self, List<SeenActor> actors, List<KnownGenerator> generators,
		List<HeardSound> sounds, List<GridPos> trails, List<GridPos> traps, List<GridPos> lockers,
		List<GridPos> gates, boolean gateOpen, double terror) {

	public record Self(int id, Role role, GridPos position, Health health, boolean hidden, double stamina,
			boolean flashlightOn, int rocks, boolean attackReady, boolean lungeReady, boolean sonarReady,
			boolean trapReady, int trapsLeft, boolean skillCheckPending, int skillCheckStartTick,
			int skillCheckDeadlineTick) {
	}

	public record SeenActor(int id, Role role, GridPos position, Health health) {
	}

	/** {@code progress} is null when the generator is out of sight. */
	public record KnownGenerator(int id, GridPos position, Double progress, boolean done) {
	}

	/** Where a noise seems to come from: a direction and loudness turned into a rough position. */
	public record HeardSound(String kind, GridPos estimatedPosition, double intensity) {
	}

	public List<SeenActor> visibleSurvivors() {
		return actors.stream().filter(a -> a.role() == Role.SURVIVOR && a.id() != self.id()).toList();
	}

	public List<SeenActor> visibleMonsters() {
		return actors.stream().filter(a -> a.role() == Role.MONSTER).toList();
	}
}
