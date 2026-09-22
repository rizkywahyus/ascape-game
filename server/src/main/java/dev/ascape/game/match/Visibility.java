package dev.ascape.game.match;

import java.util.BitSet;
import java.util.HashMap;
import java.util.Map;

import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.LineOfSight;
import dev.ascape.game.world.TileMap;

/**
 * Who may see what this tick. Everything a client or bot learns about other actors goes through here, which makes
 * it the anti-wallhack boundary: snapshots and bot perception are both filtered by {@link #canSee}.
 * Field-of-view bitsets are computed lazily once per actor per tick.
 */
public final class Visibility {

	private final TileMap map;
	private final GameRules rules;
	private final Map<Integer, BitSet> visibleCellsByActor = new HashMap<>();

	Visibility(TileMap map, GameRules rules) {
		this.map = map;
		this.rules = rules;
	}

	void invalidate() {
		visibleCellsByActor.clear();
	}

	/** Radius of the actor's field of view: its light (survivor) or dark vision plus spotting range (monster). */
	public int viewRadius(Actor actor) {
		if (actor.role == Role.MONSTER) {
			GameRules.MonsterRules monster = rules.monster();
			return Math.max(monster.visionRadius(), Math.max(monster.lightSpotRadius(), monster.trailSpotRadius()));
		}
		return lightRadius(actor);
	}

	/** Radius a survivor lights up around themselves. */
	public int lightRadius(Actor survivor) {
		return survivor.flashlightOn ? rules.survivor().flashlightRadius() : rules.survivor().darkRadius();
	}

	public boolean cellVisible(Actor viewer, GridPos cell) {
		if (!map.isInside(cell.x(), cell.y())) {
			return false;
		}
		BitSet visible = visibleCellsByActor.computeIfAbsent(viewer.id,
				id -> LineOfSight.visibleCells(map, viewer.position(), viewRadius(viewer)));
		return visible.get(cell.y() * map.width() + cell.x());
	}

	public boolean canSee(Actor viewer, Actor target) {
		if (viewer == target) {
			return true;
		}
		if (!target.health.isInPlay() || target.hidden()) {
			return false;
		}
		int distanceSquared = LineOfSight.distanceSquared(viewer.position(), target.position());
		if (viewer.role == Role.SURVIVOR) {
			if (target.role == Role.SURVIVOR) {
				return true; // teammates are always shown
			}
			int sense = rules.survivor().senseMonsterRadius();
			return distanceSquared <= sense * sense || cellVisible(viewer, target.position());
		}
		// Monster looking at a survivor.
		GameRules.MonsterRules monster = rules.monster();
		if (viewer.sonarActive() && distanceSquared <= square(monster.sonarRadius())) {
			return true;
		}
		if (!cellVisible(viewer, target.position())) {
			return false;
		}
		return distanceSquared <= square(monster.visionRadius())
				|| (target.flashlightOn && distanceSquared <= square(monster.lightSpotRadius()));
	}

	/** Traps are visible to the monster, and to survivors only within two cells and in sight. */
	public boolean canSeeTrap(Actor viewer, GridPos trap) {
		if (viewer.role == Role.MONSTER) {
			return true;
		}
		return viewer.position().chebyshevDistance(trap) <= 2 && cellVisible(viewer, trap);
	}

	/** Scratch marks are for the monster only, within its trail spotting range and line of sight. */
	public boolean canSeeTrail(Actor viewer, GridPos mark) {
		return viewer.role == Role.MONSTER
				&& LineOfSight.distanceSquared(viewer.position(), mark) <= square(rules.monster().trailSpotRadius())
				&& cellVisible(viewer, mark);
	}

	/** Generator progress is shown when the generator is in view or within reach. */
	public boolean canSeeGenerator(Actor viewer, Generator generator) {
		return generator.done || generator.isAdjacent(viewer.position()) || cellVisible(viewer, generator.position);
	}

	private static int square(int value) {
		return value * value;
	}
}
