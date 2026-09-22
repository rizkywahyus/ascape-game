package dev.ascape.game.room;

import java.util.List;
import java.util.Locale;

import dev.ascape.game.match.Actor;
import dev.ascape.game.match.Match;
import dev.ascape.game.match.Role;
import dev.ascape.game.match.Visibility;
import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.LineOfSight;
import dev.ascape.net.protocol.ServerMessages;
import dev.ascape.net.protocol.ServerMessages.CellView;
import dev.ascape.net.protocol.ServerMessages.Cooldowns;
import dev.ascape.net.protocol.ServerMessages.EntityView;
import dev.ascape.net.protocol.ServerMessages.GeneratorView;
import dev.ascape.net.protocol.ServerMessages.SelfState;
import dev.ascape.net.protocol.ServerMessages.SkillCheckView;
import dev.ascape.net.protocol.ServerMessages.Snapshot;
import dev.ascape.net.protocol.ServerMessages.SoundView;
import dev.ascape.net.protocol.ServerMessages.TrailView;

/**
 * Builds the snapshot one viewer receives. Everything about other actors is filtered through {@link Visibility},
 * so a client never learns the position of something it is not allowed to see (anti-wallhack).
 */
final class SnapshotBuilder {

	private static final double ROUNDING = 1000.0;

	private SnapshotBuilder() {
	}

	/**
	 * @param viewer     the actor whose eyes are used (the player's own, or the one being spectated)
	 * @param spectating true if the receiving player does not control {@code viewer}
	 */
	static Snapshot build(Match match, Actor viewer, long roomTick, long ackSeq, boolean spectating) {
		return build(match, viewer, roomTick, ackSeq, spectating, null);
	}

	/** @param botDebug dev-only bot states and paths, or null to omit */
	static Snapshot build(Match match, Actor viewer, long roomTick, long ackSeq, boolean spectating,
			List<ServerMessages.BotDebugView> botDebug) {
		Visibility visibility = match.visibility();
		List<EntityView> entities = match.actors().stream()
				.filter(actor -> visibility.canSee(viewer, actor))
				.map(SnapshotBuilder::entityView)
				.toList();
		List<GeneratorView> generators = match.generators().stream()
				.map(g -> new GeneratorView(g.id(), g.position().x(), g.position().y(),
						visibility.canSeeGenerator(viewer, g) ? round(g.progress()) : null, g.done()))
				.toList();
		List<CellView> traps = match.traps().stream()
				.filter(trap -> visibility.canSeeTrap(viewer, trap.position()))
				.map(trap -> new CellView(trap.position().x(), trap.position().y()))
				.toList();
		double trailLifetimeTicks = match.rules().ticks(match.rules().trail().lifetimeSeconds());
		List<TrailView> trails = match.trails().stream()
				.filter(trail -> visibility.canSeeTrail(viewer, trail.position()))
				.map(trail -> new TrailView(trail.position().x(), trail.position().y(),
						round((match.tick() - trail.createdTick()) / trailLifetimeTicks)))
				.toList();
		return new Snapshot(roomTick, ackSeq, selfState(match, viewer, spectating), entities, generators, traps, trails,
				sounds(match, viewer), botDebug);
	}

	private static EntityView entityView(Actor actor) {
		return new EntityView(actor.id(), actor.role().wireName(), actor.position().x(), actor.position().y(),
				actor.glyph(), actor.color(), actor.name(), actor.health().wireName(), actor.flashlightOn(),
				actor.activity().name().toLowerCase(Locale.ROOT));
	}

	/** Only the monster hears noises, as a direction and loudness, never an exact position. */
	private static List<SoundView> sounds(Match match, Actor viewer) {
		if (viewer.role() != Role.MONSTER) {
			return List.of();
		}
		int hearing = match.rules().monster().hearingRadius();
		GridPos ear = viewer.position();
		return match.sounds().stream()
				.filter(sound -> sound.sourceId() != viewer.id())
				.map(sound -> {
					double distance = Math.sqrt(LineOfSight.distanceSquared(ear, sound.position()));
					double intensity = 1 - distance / Math.min(sound.radius(), hearing);
					if (intensity <= 0 || distance == 0) {
						return null;
					}
					double dx = (sound.position().x() - ear.x()) / distance;
					double dy = (sound.position().y() - ear.y()) / distance;
					return new SoundView(sound.kind(), round(dx), round(dy), round(intensity));
				})
				.filter(java.util.Objects::nonNull)
				.toList();
	}

	private static SelfState selfState(Match match, Actor self, boolean spectating) {
		GameRules rules = match.rules();
		long msPerTick = 1000L / rules.tickRate();
		SkillCheckView skillCheck = self.skillCheckPending()
				? new SkillCheckView(Math.max(0, self.skillCheckStartTick() - match.tick()) * msPerTick,
						(self.skillCheckDeadlineTick() - Math.max(self.skillCheckStartTick(), match.tick()) + 1)
								* msPerTick)
				: null;
		long ownTraps = match.traps().stream().filter(t -> t.ownerId() == self.id()).count();
		Cooldowns cooldowns = new Cooldowns(self.attackCooldownTicks() * msPerTick,
				self.lungeCooldownTicks() * msPerTick, self.sonarCooldownTicks() * msPerTick,
				self.trapCooldownTicks() * msPerTick);
		return new SelfState(self.id(), self.position().x(), self.position().y(), self.moveProgress(),
				self.role().wireName(), self.health().wireName(), self.hidden(), match.canMove(self),
				match.speed(self, false), match.speed(self, true), round(self.stamina()), self.flashlightOn(),
				self.rocks(), self.activity().name().toLowerCase(Locale.ROOT), round(self.activityProgress()),
				round(match.terror(self)), self.bleedOutTicks() * msPerTick, cooldowns,
				self.role() == Role.MONSTER ? (int) (rules.monster().maxTraps() - ownTraps) : 0, self.sonarActive(),
				skillCheck, spectating);
	}

	private static double round(double value) {
		return Math.round(value * ROUNDING) / ROUNDING;
	}
}
