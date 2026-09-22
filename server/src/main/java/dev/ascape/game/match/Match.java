package dev.ascape.game.match;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;

import dev.ascape.game.match.Actor.Activity;
import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.LineOfSight;
import dev.ascape.game.world.Movement;
import dev.ascape.game.world.TileKind;
import dev.ascape.game.world.TileMap;
import dev.ascape.game.world.Walkability;

/**
 * One round of Asymmetric Hunt: 1 monster vs up to 4 survivors on a map. Pure simulation: no threads, network or
 * clock. {@link #tick(Map)} advances one fixed step with at most one input per actor; actors without input are not
 * simulated that tick (see shared/protocol.md, "input").
 */
public final class Match {

	public enum Phase {
		PLAYING, ENDGAME, FINISHED
	}

	public enum Winner {
		SURVIVORS, MONSTER
	}

	/** A monster trap on the floor. */
	public record Trap(GridPos position, int ownerId) {
	}

	/** A noise the monster may hear. {@code sourceId} is excluded from hearing its own noise. */
	public record Sound(GridPos position, int radius, String kind, int sourceId, int expiresTick) {
	}

	/** Scratch marks / blood left behind by a survivor. */
	public record Trail(GridPos position, int createdTick) {
	}

	/** Positions kept per actor for lag compensation; must exceed MAX_REWIND_TICKS. */
	static final int POSITION_HISTORY_TICKS = 8;
	/** Furthest back an attack may be checked (300 ms at 20 Hz), so a lagging or lying client gains little. */
	static final int MAX_REWIND_TICKS = 6;
	private static final double ATTACK_BUFFER_SECONDS = 0.5;

	private static final double REPAIR_SKILL_CHECK_PENALTY = 0.08;
	private static final double REPAIR_SKILL_CHECK_BONUS = 0.02;
	private static final double SKILL_CHECKS_PER_SECOND = 1.0 / 8;
	private static final double SKILL_CHECK_WARNING_SECONDS = 0.6;
	private static final double SKILL_CHECK_WINDOW_SECONDS = 0.5;
	private static final double REPAIR_NOISE_INTERVAL_SECONDS = 1.0;
	private static final int FAILED_CHECK_NOISE_MULTIPLIER = 2;
	private static final int GENERATOR_DONE_NOISE_RADIUS = 40;

	private static final int SCORE_ESCAPE = 100;
	private static final int SCORE_PER_GENERATOR = 40;
	private static final int SCORE_REVIVE = 30;
	private static final int SCORE_HEAL = 15;
	private static final int SCORE_TEAM_WIN = 50;
	private static final int SCORE_HIT = 20;
	private static final int SCORE_DOWN = 40;
	private static final int SCORE_CATCH = 80;
	private static final int SCORE_MONSTER_WIN = 150;

	private final TileMap map;
	private final GameRules rules;
	private final Random random;
	private final Visibility visibility;
	private final List<Actor> actors = new ArrayList<>();
	private final Map<Integer, Actor> actorsById = new HashMap<>();
	private final List<Generator> generators = new ArrayList<>();
	private final List<Locker> lockers = new ArrayList<>();
	private final List<GridPos> survivorSpawns;
	private final List<GridPos> monsterSpawns;
	private final List<Trap> traps = new ArrayList<>();
	private final List<Sound> sounds = new ArrayList<>();
	private final List<Trail> trails = new ArrayList<>();
	private final List<MatchEvent> events = new ArrayList<>();
	private final Walkability walkability;

	private Phase phase = Phase.PLAYING;
	private Winner winner;
	private int tick;
	private int timeLeftTicks;
	private int collapseTicks;
	private int generatorsDone;
	private int nextActorId = 1;
	private int survivorsSpawned;

	public Match(TileMap map, GameRules rules, long seed) {
		this.map = map;
		this.rules = rules;
		this.random = new Random(seed);
		this.visibility = new Visibility(map, rules);
		this.survivorSpawns = map.findAll(TileKind.SURVIVOR_SPAWN);
		this.monsterSpawns = map.findAll(TileKind.MONSTER_SPAWN);
		if (survivorSpawns.isEmpty() || monsterSpawns.isEmpty()) {
			throw new IllegalArgumentException("Map '" + map.id() + "' needs survivor and monster spawns");
		}
		List<GridPos> generatorCells = map.findAll(TileKind.GENERATOR);
		for (int i = 0; i < generatorCells.size(); i++) {
			GridPos cell = generatorCells.get(i);
			generators.add(new Generator(i + 1, cell, List.of(cell.plus(-1, 0), cell, cell.plus(1, 0))));
		}
		if (generators.size() < rules.match().generatorsNeeded()) {
			throw new IllegalArgumentException("Map '" + map.id() + "' has fewer generators than needed");
		}
		map.findAll(TileKind.LOCKER).forEach(cell -> lockers.add(new Locker(cell)));
		this.timeLeftTicks = rules.ticks(rules.match().durationSeconds());
		this.walkability = (x, y) -> !map.isSolid(x, y) || (gateOpen() && map.kindAt(x, y) == TileKind.GATE);
	}

	// ---------------------------------------------------------------- setup

	public Actor addActor(Role role, String name, String glyph, String color) {
		GridPos spawn = role == Role.MONSTER ? monsterSpawns.getFirst()
				: survivorSpawns.get(survivorsSpawned++ % survivorSpawns.size());
		Actor actor = new Actor(nextActorId++, role, name, glyph, color, spawn);
		if (role == Role.SURVIVOR) {
			actor.stamina = rules.survivor().staminaMax();
			actor.rocks = rules.survivor().rocks();
		}
		else {
			actor.flashlightOn = false;
		}
		actors.add(actor);
		actorsById.put(actor.id, actor);
		return actor;
	}

	// ---------------------------------------------------------------- queries

	public TileMap map() {
		return map;
	}

	public GameRules rules() {
		return rules;
	}

	public Visibility visibility() {
		return visibility;
	}

	public Walkability walkability() {
		return walkability;
	}

	public List<Actor> actors() {
		return Collections.unmodifiableList(actors);
	}

	public Optional<Actor> actor(int id) {
		return Optional.ofNullable(actorsById.get(id));
	}

	public Optional<Actor> monster() {
		return actors.stream().filter(a -> a.role == Role.MONSTER).findFirst();
	}

	public List<Generator> generators() {
		return Collections.unmodifiableList(generators);
	}

	public List<Locker> lockers() {
		return Collections.unmodifiableList(lockers);
	}

	public List<Trap> traps() {
		return Collections.unmodifiableList(traps);
	}

	public List<Sound> sounds() {
		return Collections.unmodifiableList(sounds);
	}

	public List<Trail> trails() {
		return Collections.unmodifiableList(trails);
	}

	public Phase phase() {
		return phase;
	}

	public Optional<Winner> winner() {
		return Optional.ofNullable(winner);
	}

	public int tick() {
		return tick;
	}

	public boolean gateOpen() {
		return phase == Phase.ENDGAME || (phase == Phase.FINISHED && generatorsDone >= rules.match().generatorsNeeded());
	}

	public int generatorsDone() {
		return generatorsDone;
	}

	/** Ticks until the match timer (PLAYING) or the collapse (ENDGAME) ends it. */
	public int ticksLeft() {
		return phase == Phase.ENDGAME ? collapseTicks : phase == Phase.PLAYING ? timeLeftTicks : 0;
	}

	public List<MatchEvent> drainEvents() {
		List<MatchEvent> drained = List.copyOf(events);
		events.clear();
		return drained;
	}

	/** Heartbeat intensity for a survivor: 1 next to the monster, 0 at the terror radius or beyond. */
	public double terror(Actor survivor) {
		return monster().filter(m -> survivor.role == Role.SURVIVOR)
				.map(m -> {
					double distance = Math.sqrt(LineOfSight.distanceSquared(m.position(), survivor.position()));
					return Math.max(0, 1 - distance / rules.monster().terrorRadius());
				})
				.orElse(0.0);
	}

	/** Speed the actor would move at next tick, walking or sprinting; used for client prediction too. */
	public double speed(Actor actor, boolean sprint) {
		if (actor.role == Role.MONSTER) {
			GameRules.MonsterRules monster = rules.monster();
			if (actor.attackSlowTicks > 0) {
				return monster.attackSlowSpeed();
			}
			return actor.lungeTicks > 0 ? monster.lungeSpeed() : monster.walkSpeed();
		}
		GameRules.SurvivorRules survivor = rules.survivor();
		if (actor.health == Health.DOWNED) {
			return survivor.downedCrawlSpeed();
		}
		if (actor.hitBoostTicks > 0) {
			return survivor.hitBoostSpeed();
		}
		return sprint && actor.stamina > 0 ? survivor.sprintSpeed() : survivor.walkSpeed();
	}

	public boolean canMove(Actor actor) {
		return phase != Phase.FINISHED && actor.health.isInPlay() && !actor.hidden() && actor.trappedTicks == 0;
	}

	// ---------------------------------------------------------------- simulation

	/** Advances one tick. {@code inputs} maps actor id to its input for this tick; absent actors are starved. */
	public void tick(Map<Integer, PlayerInput> inputs) {
		if (phase == Phase.FINISHED) {
			return;
		}
		tick++;
		visibility.invalidate();

		for (Actor actor : actors) {
			PlayerInput input = inputs.get(actor.id);
			if (input != null && actor.health.isInPlay()) {
				applyActions(actor, input);
				applyInteractPress(actor, input);
			}
		}
		for (Actor actor : actors) {
			PlayerInput input = inputs.get(actor.id);
			boolean sprinted = input != null && canMove(actor) && applyMovement(actor, input);
			updateStamina(actor, sprinted);
		}
		for (Actor actor : actors) {
			PlayerInput input = inputs.get(actor.id);
			if (input != null && actor.role == Role.MONSTER && input.has(PlayerInput.ATTACK)) {
				requestAttack(actor, input);
			}
		}
		applyChannelling(inputs);
		updateTimers();
		fireBufferedAttacks();
		recordPositions();
		expireNoiseAndTrails();
		updateObjectives();
	}

	private void applyActions(Actor actor, PlayerInput input) {
		if (actor.role == Role.MONSTER) {
			// Attacks resolve after movement (see tick()), matching the predicted position the player sees.
			if (input.has(PlayerInput.LUNGE) && actor.lungeCooldownTicks == 0 && actor.attackSlowTicks == 0) {
				actor.lungeTicks = rules.ticks(rules.monster().lungeSeconds());
				actor.lungeCooldownTicks = rules.ticks(rules.monster().lungeCooldownSeconds());
			}
			if (input.has(PlayerInput.SONAR) && actor.sonarCooldownTicks == 0) {
				actor.sonarTicks = rules.ticks(rules.monster().sonarSeconds());
				actor.sonarCooldownTicks = rules.ticks(rules.monster().sonarCooldownSeconds());
				events.add(new MatchEvent.Sonar(actor.id));
			}
			if (input.has(PlayerInput.TRAP)) {
				placeTrap(actor);
			}
			return;
		}
		if (!actor.health.isActive()) {
			return;
		}
		if (input.has(PlayerInput.FLASHLIGHT)) {
			actor.flashlightOn = !actor.flashlightOn;
		}
		if (input.has(PlayerInput.THROW) && actor.rocks > 0 && !actor.hidden()) {
			throwRock(actor);
		}
		if (input.has(PlayerInput.SKILL_CHECK) && actor.skillCheckPending()) {
			resolveSkillCheck(actor, tick >= actor.skillCheckStartTick);
		}
	}

	/** Attacks now, or buffers the press if the cooldown is about to end so an early press is not lost. */
	private void requestAttack(Actor monster, PlayerInput input) {
		if (monster.attackCooldownTicks == 0) {
			attack(monster, input.viewTick());
		}
		else if (monster.attackCooldownTicks <= rules.ticks(ATTACK_BUFFER_SECONDS)) {
			monster.attackBufferedUntilTick = tick + monster.attackCooldownTicks;
			monster.bufferedAttackViewTick = input.viewTick();
		}
	}

	/**
	 * Swings at the nearest survivor in reach. Lag compensation: the attacker saw survivors {@code tick - viewTick}
	 * ticks in the past (interpolation + latency), so a survivor counts as in reach if it is next to the monster now
	 * or was at the tick the attacker was looking at (capped at MAX_REWIND_TICKS).
	 */
	private void attack(Actor monster, long viewTick) {
		GameRules.MonsterRules rulesForMonster = rules.monster();
		// A miss recovers quickly; a hit costs more (the swing follow-through). The slow is the same either way
		// so the client can predict it the moment the player swings.
		monster.attackCooldownTicks = rules.ticks(rulesForMonster.attackMissCooldownSeconds());
		monster.attackSlowTicks = rules.ticks(rulesForMonster.attackSlowSeconds());
		monster.attackBufferedUntilTick = -1;
		monster.lungeTicks = 0;
		int rewind = viewTick <= 0 ? 0 : (int) Math.clamp(tick - viewTick, 0, MAX_REWIND_TICKS);
		actors.stream()
				.filter(a -> a.role == Role.SURVIVOR && a.health.isActive() && !a.hidden())
				.filter(a -> inReach(monster, a.position(), rulesForMonster)
						|| inReach(monster, positionAgo(a, rewind), rulesForMonster))
				.min(Comparator.comparingInt((Actor a) -> LineOfSight.distanceSquared(a.position(), monster.position()))
						.thenComparingInt(a -> a.id))
				.ifPresent(victim -> hit(monster, victim));
	}

	private static boolean inReach(Actor monster, GridPos target, GameRules.MonsterRules rules) {
		return target.chebyshevDistance(monster.position()) <= rules.attackRange();
	}

	/** Where the actor stood {@code ticksAgo} ticks ago (its current cell if history does not reach back that far). */
	private GridPos positionAgo(Actor actor, int ticksAgo) {
		if (ticksAgo <= 0) {
			return actor.position();
		}
		GridPos past = actor.positionHistory[Math.floorMod(tick - ticksAgo, POSITION_HISTORY_TICKS)];
		return past != null ? past : actor.position();
	}

	private void hit(Actor monster, Actor victim) {
		monster.attackCooldownTicks = rules.ticks(rules.monster().attackHitCooldownSeconds());
		monster.stats.hits++;
		victim.stats.hitsTaken++;
		emitSound(victim.position(), rules.sound().hitRadius(), "scream", -1);
		events.add(new MatchEvent.Hit(monster.id, victim.id, victim.position()));
		victim.healProgress = 0;
		if (victim.health == Health.HEALTHY) {
			victim.health = Health.INJURED;
			victim.hitBoostTicks = rules.ticks(rules.survivor().hitBoostSeconds());
		}
		else {
			down(monster, victim);
		}
	}

	private void down(Actor monster, Actor victim) {
		monster.stats.downs++;
		victim.health = Health.DOWNED;
		victim.bleedOutTicks = rules.ticks(rules.survivor().bleedOutSeconds());
		victim.reviveProgress = 0;
		victim.hitBoostTicks = 0;
		clearSkillCheck(victim);
		events.add(new MatchEvent.Downed(victim.id, victim.position()));
	}

	private void placeTrap(Actor monster) {
		GridPos cell = monster.position();
		long own = traps.stream().filter(t -> t.ownerId() == monster.id).count();
		boolean occupied = traps.stream().anyMatch(t -> t.position().equals(cell));
		if (monster.trapCooldownTicks > 0 || own >= rules.monster().maxTraps() || occupied
				|| map.kindAt(cell.x(), cell.y()) == TileKind.GATE) {
			return;
		}
		traps.add(new Trap(cell, monster.id));
		monster.trapCooldownTicks = rules.ticks(rules.monster().trapCooldownSeconds());
	}

	private void throwRock(Actor survivor) {
		GridPos landing = survivor.position();
		for (int step = 1; step <= rules.survivor().rockThrowDistance(); step++) {
			GridPos next = survivor.position().plus(survivor.facingDx * step, survivor.facingDy * step);
			if (map.isOpaque(next.x(), next.y())) {
				break;
			}
			landing = next;
		}
		survivor.rocks--;
		emitSound(landing, rules.sound().rockRadius(), "rock", survivor.id);
	}

	private void applyInteractPress(Actor actor, PlayerInput input) {
		boolean pressed = input.interact() && !actor.interactHeld;
		actor.interactHeld = input.interact();
		if (!pressed) {
			return;
		}
		if (actor.role == Role.MONSTER) {
			if (adjacentSurvivor(actor, Health.DOWNED).isPresent()) {
				return; // held interact carries the survivor off, see applyChannelling
			}
			if (actor.attackCooldownTicks == 0) {
				// Pulling someone out of a locker counts as a hit (and costs the swing).
				adjacentLocker(actor.position(), true).ifPresent(locker -> {
					Actor found = locker.occupant;
					leaveLocker(found);
					hit(actor, found);
				});
			}
			return;
		}
		if (actor.hidden()) {
			leaveLocker(actor);
			return;
		}
		// Something to repair, revive or heal takes priority over a locker next to it.
		boolean hasChannelTarget = adjacentSurvivor(actor, Health.DOWNED).isPresent()
				|| adjacentSurvivor(actor, Health.INJURED).isPresent()
				|| adjacentUnfinishedGenerator(actor).isPresent();
		if (actor.health.isActive() && !hasChannelTarget) {
			adjacentLocker(actor.position(), false).ifPresent(locker -> enterLocker(actor, locker));
		}
	}

	private void catchSurvivor(Actor monster, Actor victim) {
		monster.stats.catches++;
		monster.catchProgress = 0;
		victim.health = Health.CAUGHT;
		events.add(new MatchEvent.Caught(victim.id, monster.id));
	}

	/** Monster holding interact, standing still, next to a downed survivor: carry them off after catchSeconds. */
	private void applyMonsterCatch(Actor monster, PlayerInput input) {
		Optional<Actor> downed = input == null || !input.interact() || input.moving() ? Optional.empty()
				: adjacentSurvivor(monster, Health.DOWNED);
		if (downed.isEmpty()) {
			monster.catchProgress = 0;
			monster.activity = Activity.NONE;
			monster.activityProgress = 0;
			return;
		}
		monster.catchProgress += 1.0 / rules.ticks(rules.monster().catchSeconds());
		monster.activity = Activity.CATCH;
		monster.activityProgress = Math.min(monster.catchProgress, 1);
		if (monster.catchProgress >= 1) {
			catchSurvivor(monster, downed.get());
			monster.activity = Activity.NONE;
			monster.activityProgress = 0;
		}
	}

	private void enterLocker(Actor survivor, Locker locker) {
		locker.occupant = survivor;
		survivor.hiddenIn = locker;
		survivor.hiddenFrom = survivor.position();
		clearSkillCheck(survivor);
		emitSound(locker.position, rules.sound().lockerRadius(), "locker", survivor.id);
	}

	private void leaveLocker(Actor survivor) {
		Locker locker = survivor.hiddenIn;
		locker.occupant = null;
		survivor.hiddenIn = null;
		survivor.move = new Movement.MoveState(survivor.hiddenFrom, survivor.move.progress());
		survivor.hiddenFrom = null;
		emitSound(locker.position, rules.sound().lockerRadius(), "locker", survivor.id);
	}

	/** Returns true if the actor sprinted this tick. */
	private boolean applyMovement(Actor actor, PlayerInput input) {
		boolean sprinting = actor.role == Role.SURVIVOR && actor.health.isActive() && actor.hitBoostTicks == 0
				&& input.sprint() && input.moving() && actor.stamina > 0;
		double speed = speed(actor, sprinting);
		GridPos before = actor.position();
		actor.move = Movement.advance(walkability, actor.move, input.dx(), input.dy(), speed, rules.tickRate());
		if (input.moving()) {
			actor.facingDx = input.dx();
			actor.facingDy = input.dy();
		}
		if (!actor.position().equals(before)) {
			onEnteredCell(actor, sprinting);
		}
		return sprinting;
	}

	private void onEnteredCell(Actor actor, boolean sprinting) {
		if (actor.role != Role.SURVIVOR) {
			return;
		}
		GridPos cell = actor.position();
		if (sprinting) {
			emitSound(cell, rules.sound().sprintRadius(), "footsteps", actor.id);
		}
		if (sprinting) {
			trails.add(new Trail(cell, tick));
		}
		traps.stream().filter(t -> t.position().equals(cell)).findFirst().ifPresent(trap -> {
			traps.remove(trap);
			actor.trappedTicks = rules.ticks(rules.monster().trapStunSeconds());
			emitSound(cell, rules.sound().trapRadius(), "trap", -1);
			events.add(new MatchEvent.TrapTriggered(actor.id, cell));
		});
		if (gateOpen() && actor.health.isActive() && map.kindAt(cell.x(), cell.y()) == TileKind.GATE) {
			actor.health = Health.ESCAPED;
			events.add(new MatchEvent.Escaped(actor.id));
		}
	}

	private void updateStamina(Actor actor, boolean sprinted) {
		if (actor.role != Role.SURVIVOR) {
			return;
		}
		GameRules.SurvivorRules survivor = rules.survivor();
		if (sprinted) {
			actor.stamina = Math.max(0, actor.stamina - survivor.sprintDrainPerSecond() * rules.tickSeconds());
			actor.staminaRegenDelayTicks = rules.ticks(survivor.staminaRegenDelaySeconds());
		}
		else if (actor.staminaRegenDelayTicks > 0) {
			actor.staminaRegenDelayTicks--;
		}
		else {
			actor.stamina = Math.min(survivor.staminaMax(),
					actor.stamina + survivor.staminaRegenPerSecond() * rules.tickSeconds());
		}
	}

	/**
	 * Held interact without moving. Survivors revive an adjacent downed teammate, else repair an adjacent generator,
	 * else heal an adjacent injured teammate; the monster carries off an adjacent downed survivor.
	 */
	private void applyChannelling(Map<Integer, PlayerInput> inputs) {
		Map<Generator, List<Actor>> repairers = new HashMap<>();
		for (Actor actor : actors) {
			if (actor.role == Role.MONSTER) {
				if (phase != Phase.FINISHED) {
					applyMonsterCatch(actor, inputs.get(actor.id));
				}
				continue;
			}
			PlayerInput input = inputs.get(actor.id);
			boolean channelling = input != null && input.interact() && !input.moving() && actor.health.isActive()
					&& !actor.hidden() && actor.trappedTicks == 0 && phase != Phase.FINISHED;
			if (!channelling) {
				stopChannelling(actor);
				continue;
			}
			Optional<Actor> downed = adjacentSurvivor(actor, Health.DOWNED);
			if (downed.isPresent()) {
				revive(actor, downed.get());
				continue;
			}
			Optional<Actor> injured = adjacentSurvivor(actor, Health.INJURED);
			if (injured.isPresent() && adjacentUnfinishedGenerator(actor).isEmpty()) {
				heal(actor, injured.get());
				continue;
			}
			Optional<Generator> generator = adjacentUnfinishedGenerator(actor);
			if (generator.isPresent()) {
				repairers.computeIfAbsent(generator.get(), g -> new ArrayList<>()).add(actor);
			}
			else {
				stopChannelling(actor);
			}
		}
		repairers.forEach(this::repair);
	}

	private void stopChannelling(Actor actor) {
		actor.activity = Activity.NONE;
		actor.activityProgress = 0;
		clearSkillCheck(actor);
	}

	private void revive(Actor reviver, Actor downed) {
		clearSkillCheck(reviver);
		downed.reviveProgress += 1.0 / rules.ticks(rules.survivor().reviveSeconds());
		reviver.activity = Activity.REVIVE;
		reviver.activityProgress = Math.min(downed.reviveProgress, 1);
		if (downed.reviveProgress >= 1) {
			downed.health = Health.INJURED;
			downed.reviveProgress = 0;
			downed.bleedOutTicks = 0;
			reviver.stats.revives++;
			events.add(new MatchEvent.Revived(downed.id, reviver.id));
		}
	}

	private void heal(Actor healer, Actor injured) {
		clearSkillCheck(healer);
		injured.healProgress += 1.0 / rules.ticks(rules.survivor().healSeconds());
		healer.activity = Activity.HEAL;
		healer.activityProgress = Math.min(injured.healProgress, 1);
		if (injured.healProgress >= 1) {
			injured.health = Health.HEALTHY;
			injured.healProgress = 0;
			healer.stats.heals++;
		}
	}

	private void repair(Generator generator, List<Actor> workers) {
		double perTick = 1.0 / rules.ticks(rules.survivor().repairSecondsSolo());
		double efficiency = 1 + (workers.size() - 1) * rules.survivor().extraRepairerEfficiency();
		double gained = Math.min(perTick * efficiency, 1 - generator.progress);
		generator.progress += gained;
		for (Actor worker : workers) {
			worker.stats.generatorWork += gained / workers.size();
			worker.activity = Activity.REPAIR;
			worker.activityProgress = generator.progress;
			maybeStartSkillCheck(worker, generator);
		}
		if (tick >= generator.nextNoiseTick) {
			emitSound(generator.position, rules.sound().repairRadius(), "repair", workers.getFirst().id);
			generator.nextNoiseTick = tick + rules.ticks(REPAIR_NOISE_INTERVAL_SECONDS);
		}
		if (generator.progress >= 1) {
			completeGenerator(generator, workers);
		}
	}

	private void completeGenerator(Generator generator, List<Actor> workers) {
		generator.progress = 1;
		generator.done = true;
		generatorsDone++;
		workers.forEach(worker -> {
			worker.stats.generatorsCompleted++;
			stopChannelling(worker);
		});
		emitSound(generator.position, GENERATOR_DONE_NOISE_RADIUS, "generator", -1);
		events.add(new MatchEvent.GeneratorDone(generator.id, generator.position));
		if (phase == Phase.PLAYING && generatorsDone >= rules.match().generatorsNeeded()) {
			phase = Phase.ENDGAME;
			collapseTicks = rules.ticks(rules.match().endgameCollapseSeconds());
			events.add(new MatchEvent.GateOpened());
		}
	}

	private void maybeStartSkillCheck(Actor worker, Generator generator) {
		if (worker.skillCheckPending() || random.nextDouble() >= SKILL_CHECKS_PER_SECOND / rules.tickRate()) {
			return;
		}
		worker.skillCheckGeneratorId = generator.id;
		worker.skillCheckStartTick = tick + rules.ticks(SKILL_CHECK_WARNING_SECONDS);
		worker.skillCheckDeadlineTick = worker.skillCheckStartTick + rules.ticks(SKILL_CHECK_WINDOW_SECONDS);
	}

	private void resolveSkillCheck(Actor survivor, boolean success) {
		Generator generator = generators.get(survivor.skillCheckGeneratorId - 1);
		clearSkillCheck(survivor);
		if (generator.done) {
			return;
		}
		if (success) {
			generator.progress = Math.min(generator.progress + REPAIR_SKILL_CHECK_BONUS, 1);
		}
		else {
			generator.progress = Math.max(generator.progress - REPAIR_SKILL_CHECK_PENALTY, 0);
			emitSound(generator.position, rules.sound().repairRadius() * FAILED_CHECK_NOISE_MULTIPLIER, "explosion", -1);
		}
		events.add(new MatchEvent.SkillCheck(survivor.id, generator.id, success));
	}

	private static void clearSkillCheck(Actor actor) {
		actor.skillCheckStartTick = -1;
		actor.skillCheckDeadlineTick = -1;
	}

	private void updateTimers() {
		for (Actor actor : actors) {
			actor.attackCooldownTicks = decrement(actor.attackCooldownTicks);
			actor.attackSlowTicks = decrement(actor.attackSlowTicks);
			actor.lungeTicks = decrement(actor.lungeTicks);
			actor.lungeCooldownTicks = decrement(actor.lungeCooldownTicks);
			actor.sonarTicks = decrement(actor.sonarTicks);
			actor.sonarCooldownTicks = decrement(actor.sonarCooldownTicks);
			actor.trapCooldownTicks = decrement(actor.trapCooldownTicks);
			actor.hitBoostTicks = decrement(actor.hitBoostTicks);
			actor.trappedTicks = decrement(actor.trappedTicks);
			if (actor.skillCheckPending() && tick > actor.skillCheckDeadlineTick) {
				resolveSkillCheck(actor, false);
			}
			if (actor.health == Health.DOWNED) {
				actor.bleedOutTicks = decrement(actor.bleedOutTicks);
				if (actor.bleedOutTicks == 0) {
					actor.health = Health.CAUGHT;
					events.add(new MatchEvent.Caught(actor.id, null));
				}
			}
		}
	}

	private void fireBufferedAttacks() {
		for (Actor actor : actors) {
			if (actor.attackBufferedUntilTick >= 0 && actor.attackCooldownTicks == 0) {
				if (tick <= actor.attackBufferedUntilTick + 1) {
					attack(actor, actor.bufferedAttackViewTick);
				}
				actor.attackBufferedUntilTick = -1;
			}
		}
	}

	private void recordPositions() {
		for (Actor actor : actors) {
			actor.positionHistory[Math.floorMod(tick, POSITION_HISTORY_TICKS)] = actor.position();
		}
	}

	private static int decrement(int ticks) {
		return Math.max(0, ticks - 1);
	}

	private void expireNoiseAndTrails() {
		sounds.removeIf(sound -> sound.expiresTick() <= tick);
		int trailLifetime = rules.ticks(rules.trail().lifetimeSeconds());
		trails.removeIf(trail -> tick - trail.createdTick() >= trailLifetime);
	}

	private void updateObjectives() {
		if (phase == Phase.PLAYING && --timeLeftTicks <= 0) {
			finish();
			return;
		}
		if (phase == Phase.ENDGAME && --collapseTicks <= 0) {
			finish();
			return;
		}
		List<Actor> survivors = actors.stream().filter(a -> a.role == Role.SURVIVOR).toList();
		if (!survivors.isEmpty() && survivors.stream().noneMatch(a -> a.health.isInPlay())) {
			finish();
		}
	}

	private void finish() {
		boolean anyEscaped = actors.stream().anyMatch(a -> a.health == Health.ESCAPED);
		winner = anyEscaped ? Winner.SURVIVORS : Winner.MONSTER;
		phase = Phase.FINISHED;
		for (Actor actor : actors) {
			if (actor.role == Role.SURVIVOR && actor.health.isInPlay()) {
				actor.health = Health.CAUGHT; // left behind when the gate collapsed or time ran out
			}
			if (actor.hidden()) {
				actor.hiddenIn.occupant = null;
				actor.hiddenIn = null;
			}
			actor.stats.score = score(actor);
		}
	}

	private int score(Actor actor) {
		Actor.Stats stats = actor.stats;
		if (actor.role == Role.MONSTER) {
			return stats.hits * SCORE_HIT + stats.downs * SCORE_DOWN + stats.catches * SCORE_CATCH
					+ (winner == Winner.MONSTER ? SCORE_MONSTER_WIN : 0);
		}
		return (actor.health == Health.ESCAPED ? SCORE_ESCAPE : 0)
				+ (int) Math.round(stats.generatorWork * SCORE_PER_GENERATOR)
				+ stats.revives * SCORE_REVIVE
				+ stats.heals * SCORE_HEAL
				+ (winner == Winner.SURVIVORS ? SCORE_TEAM_WIN : 0);
	}

	// ---------------------------------------------------------------- helpers

	private void emitSound(GridPos at, int radius, String kind, int sourceId) {
		sounds.add(new Sound(at, radius, kind, sourceId, tick + rules.ticks(rules.sound().lifetimeSeconds())));
	}

	private Optional<Actor> adjacentSurvivor(Actor actor, Health health) {
		return actors.stream()
				.filter(other -> other != actor && other.role == Role.SURVIVOR && other.health == health)
				.filter(other -> other.position().chebyshevDistance(actor.position()) <= 1)
				.min(Comparator.comparingInt(other -> other.id));
	}

	private Optional<Generator> adjacentUnfinishedGenerator(Actor actor) {
		if (gateOpen()) {
			return Optional.empty();
		}
		return generators.stream().filter(g -> !g.done && g.isAdjacent(actor.position())).findFirst();
	}

	private Optional<Locker> adjacentLocker(GridPos position, boolean occupied) {
		return lockers.stream()
				.filter(locker -> locker.occupied() == occupied && locker.position.chebyshevDistance(position) <= 1)
				.findFirst();
	}
}
