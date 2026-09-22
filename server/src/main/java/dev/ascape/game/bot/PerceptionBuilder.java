package dev.ascape.game.bot;

import java.util.List;
import java.util.Objects;
import java.util.Random;

import dev.ascape.game.match.Actor;
import dev.ascape.game.match.Match;
import dev.ascape.game.match.Role;
import dev.ascape.game.match.Visibility;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.LineOfSight;
import dev.ascape.game.world.TileKind;

/**
 * Builds a bot's {@link Perception} through the same visibility rules that filter player snapshots. This is the
 * only place bot code touches the {@link Match}, which keeps bots from reading the full world state.
 */
final class PerceptionBuilder {

	/** Sounds are heard as direction + loudness; the distance estimate from loudness is this noisy. */
	private static final double DISTANCE_NOISE = 0.25;

	private PerceptionBuilder() {
	}

	static Perception build(Match match, Actor self, Difficulty difficulty, Random random) {
		Visibility visibility = match.visibility();
		int perceptionRangeSquared = square(visibility.viewRadius(self) * difficulty.perceptionScale + 2);
		List<Perception.SeenActor> actors = match.actors().stream()
				.filter(other -> visibility.canSee(self, other))
				.filter(other -> other == self || self.role() == Role.SURVIVOR && other.role() == Role.SURVIVOR
						|| LineOfSight.distanceSquared(self.position(), other.position()) <= perceptionRangeSquared
						|| self.sonarActive())
				.map(other -> new Perception.SeenActor(other.id(), other.role(), other.position(), other.health()))
				.toList();
		List<Perception.KnownGenerator> generators = match.generators().stream()
				.map(g -> new Perception.KnownGenerator(g.id(), g.position(),
						visibility.canSeeGenerator(self, g) ? g.progress() : null, g.done()))
				.toList();
		return new Perception(match.tick(), match.map(), self(match, self), actors, generators, sounds(match, self, random),
				match.trails().stream().map(Match.Trail::position).filter(p -> visibility.canSeeTrail(self, p)).toList(),
				match.traps().stream().map(Match.Trap::position).filter(p -> visibility.canSeeTrap(self, p)).toList(),
				match.lockers().stream().map(locker -> locker.position()).toList(),
				match.map().findAll(TileKind.GATE), match.gateOpen(), match.terror(self));
	}

	private static Perception.Self self(Match match, Actor self) {
		long ownTraps = match.traps().stream().filter(t -> t.ownerId() == self.id()).count();
		int trapsLeft = self.role() == Role.MONSTER ? (int) (match.rules().monster().maxTraps() - ownTraps) : 0;
		return new Perception.Self(self.id(), self.role(), self.position(), self.health(), self.hidden(),
				self.stamina(), self.flashlightOn(), self.rocks(), self.attackCooldownTicks() == 0,
				self.lungeCooldownTicks() == 0, self.sonarCooldownTicks() == 0, self.trapCooldownTicks() == 0,
				trapsLeft, self.skillCheckPending(), self.skillCheckStartTick(), self.skillCheckDeadlineTick());
	}

	/** Same filter as the monster's snapshot: direction and loudness, turned into a rough guess of the spot. */
	private static List<Perception.HeardSound> sounds(Match match, Actor self, Random random) {
		if (self.role() != Role.MONSTER) {
			return List.of();
		}
		int hearing = match.rules().monster().hearingRadius();
		GridPos ear = self.position();
		return match.sounds().stream()
				.filter(sound -> sound.sourceId() != self.id())
				.map(sound -> {
					double distance = Math.sqrt(LineOfSight.distanceSquared(ear, sound.position()));
					int audible = Math.min(sound.radius(), hearing);
					double intensity = 1 - distance / audible;
					if (intensity <= 0 || distance == 0) {
						return null;
					}
					double guessedDistance = (1 - intensity) * audible * (1 + (random.nextDouble() * 2 - 1) * DISTANCE_NOISE);
					double dx = (sound.position().x() - ear.x()) / distance;
					double dy = (sound.position().y() - ear.y()) / distance;
					GridPos guess = new GridPos((int) Math.round(ear.x() + dx * guessedDistance),
							(int) Math.round(ear.y() + dy * guessedDistance));
					return new Perception.HeardSound(sound.kind(), guess, intensity);
				})
				.filter(Objects::nonNull)
				.toList();
	}

	private static int square(double value) {
		return (int) Math.ceil(value * value);
	}
}
