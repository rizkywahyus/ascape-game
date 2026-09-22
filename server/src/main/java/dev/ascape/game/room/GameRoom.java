package dev.ascape.game.room;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Queue;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

import dev.ascape.game.bot.Bot;
import dev.ascape.game.bot.Difficulty;
import dev.ascape.game.match.Actor;
import dev.ascape.game.match.Health;
import dev.ascape.game.match.Match;
import dev.ascape.game.match.MatchEvent;
import dev.ascape.game.match.PlayerInput;
import dev.ascape.game.match.Role;
import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.TileMap;
import dev.ascape.net.ClientConnection;
import dev.ascape.net.PlayerIdentity;
import dev.ascape.net.protocol.ClientMessages.Input;
import dev.ascape.net.protocol.ServerMessage;
import dev.ascape.net.protocol.ServerMessages;
import dev.ascape.player.MatchRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * One room: a lobby that turns into a match of 1 monster vs 4 survivors, then shows the result and starts over.
 * Runs a fixed-timestep loop on its own thread. Network threads only enqueue {@link RoomCommand}s; every mutation
 * happens on the room thread, so neither the room nor the {@link Match} needs locking.
 * <p>
 * Empty slots are filled with bots. A player who disconnects mid-match is replaced by a bot immediately and can
 * reclaim the character within a grace period; a player joining mid-match takes over a bot.
 */
public final class GameRoom {

	public enum Phase {
		LOBBY, PLAYING, RESULT
	}

	/** Room state for the matchmaker, published by the room thread every tick. */
	public record Status(Phase phase, int members, boolean botMonster, boolean botSurvivor,
			Set<String> reservedPlayerIds) {
	}

	public static final int CAPACITY = 5;
	/** Inputs older than this many ticks are dropped so a lagging client cannot bank movement. */
	static final int MAX_PENDING_INPUTS = 6;

	private static final Logger log = LoggerFactory.getLogger(GameRoom.class);
	private static final double STATUS_BROADCAST_SECONDS = 1.0;
	private static final double RECONNECT_GRACE_SECONDS = 30;
	private static final String BOT_MONSTER_NAME = "the thing (bot)";
	private static final List<String> BOT_SURVIVOR_NAMES = List.of("ada", "bram", "cleo", "dex");
	private static final List<String> SURVIVOR_COLORS = List.of("#f5f0e0", "#5dade2", "#58d68d", "#f4d03f");
	private static final String SURVIVOR_GLYPH = "@";
	private static final String MONSTER_GLYPH = "M";
	private static final String MONSTER_COLOR = "#c0392b";

	/** A connected player in this room. */
	private static final class Member {
		final ClientConnection connection;
		final RolePreference rolePref;
		Integer actorId;
		boolean lobbyDirty = true;

		Member(ClientConnection connection, RolePreference rolePref) {
			this.connection = connection;
			this.rolePref = rolePref;
		}
	}

	/** Who drives an actor: a connected human's queued inputs, or a bot. */
	private sealed interface Controller permits HumanControl, BotControl {
	}

	private static final class HumanControl implements Controller {
		final Deque<PlayerInput> pending = new ArrayDeque<>();
		long lastAppliedSeq;
	}

	private record BotControl(Bot bot) implements Controller {
	}

	/** A disconnected player's character, held for them until {@code expiresTick}. */
	private record ReservedSeat(int actorId, long expiresTick) {
	}

	private final String id;
	private final TileMap map;
	private final GameRules rules;
	private final Difficulty botDifficulty;
	private final boolean botDebugView;
	private final RoomMetrics metrics;
	private final Consumer<MatchRecord> matchSink;
	private final ScheduledExecutorService executor;
	private final Queue<RoomCommand> commands = new ConcurrentLinkedQueue<>();
	private final AtomicInteger pendingJoins = new AtomicInteger();
	private final long tickNanos;
	private final ServerMessages.MapData mapData;
	private final Random random;

	// Room-thread state.
	private final Map<ClientConnection, Member> members = new LinkedHashMap<>();
	private final Map<Integer, Controller> controllers = new HashMap<>();
	/** Last human identity per actor, credited in the match record. */
	private final Map<Integer, PlayerIdentity> owners = new HashMap<>();
	private final Map<String, ReservedSeat> reservedSeats = new HashMap<>();
	private Phase phase = Phase.LOBBY;
	private Match match;
	private Instant matchStartedAt;
	private long tick;
	private long countdownTicks = -1;
	private long resultTicks;
	private long nextStatusTick;

	// Read by other threads.
	private volatile Status status = new Status(Phase.LOBBY, 0, false, false, Set.of());
	private volatile long emptySinceNanos = System.nanoTime();

	GameRoom(String id, TileMap map, GameRules rules, Difficulty botDifficulty, boolean botDebugView,
			RoomMetrics metrics, Consumer<MatchRecord> matchSink, long seed) {
		this.id = id;
		this.botDebugView = botDebugView;
		this.map = map;
		this.rules = rules;
		this.botDifficulty = botDifficulty;
		this.metrics = metrics;
		this.matchSink = matchSink;
		this.random = new Random(seed);
		this.tickNanos = TimeUnit.SECONDS.toNanos(1) / rules.tickRate();
		this.mapData = new ServerMessages.MapData(map.id(), map.rows());
		this.executor = Executors.newSingleThreadScheduledExecutor(
				Thread.ofPlatform().name("room-" + id).daemon().factory());
	}

	public String id() {
		return id;
	}

	public Status status() {
		return status;
	}

	public int playerCount() {
		return status.members();
	}

	int pendingJoins() {
		return pendingJoins.get();
	}

	void start() {
		executor.scheduleAtFixedRate(this::runTick, 0, tickNanos, TimeUnit.NANOSECONDS);
	}

	void stop() {
		executor.shutdownNow();
	}

	boolean isIdleFor(long idleNanos, long nowNanos) {
		Status current = status;
		return pendingJoins.get() == 0 && current.members() == 0 && current.reservedPlayerIds().isEmpty()
				&& nowNanos - emptySinceNanos >= idleNanos;
	}

	// ---------------------------------------------------------------- commands (any thread)

	void submitJoin(ClientConnection connection, RolePreference rolePref) {
		pendingJoins.incrementAndGet();
		commands.add(new RoomCommand.Join(connection, rolePref));
	}

	public void submitLeave(ClientConnection connection) {
		commands.add(new RoomCommand.Leave(connection));
	}

	public void submitInput(ClientConnection connection, Input input) {
		commands.add(new RoomCommand.ApplyInput(connection, input));
	}

	public void submitChat(ClientConnection connection, String text) {
		commands.add(new RoomCommand.Chat(connection, text));
	}

	// ---------------------------------------------------------------- loop

	private void runTick() {
		long start = System.nanoTime();
		try {
			tick();
		}
		catch (RuntimeException e) {
			// An exception escaping a scheduled task would silently cancel the loop; log and keep ticking.
			log.error("Room {} tick {} failed", id, tick, e);
		}
		long duration = System.nanoTime() - start;
		metrics.recordTick(duration);
		if (duration > tickNanos) {
			log.warn("Room {} tick {} took {} µs (budget {} µs)", id, tick, duration / 1_000, tickNanos / 1_000);
		}
	}

	private void tick() {
		drainCommands();
		reservedSeats.values().removeIf(seat -> seat.expiresTick() <= tick);
		switch (phase) {
			case LOBBY -> tickLobby();
			case PLAYING -> tickMatch();
			case RESULT -> tickResult();
		}
		publishStatus();
		tick++;
	}

	private void drainCommands() {
		RoomCommand command;
		while ((command = commands.poll()) != null) {
			switch (command) {
				case RoomCommand.Join join -> handleJoin(join.connection(), join.rolePref());
				case RoomCommand.Leave leave -> handleLeave(leave.connection());
				case RoomCommand.ApplyInput apply -> handleInput(apply.connection(), apply.input());
				case RoomCommand.Chat chat -> broadcast(new ServerMessages.Chat(chat.connection().displayName(),
						chat.text(), System.currentTimeMillis()));
			}
		}
	}

	// ---------------------------------------------------------------- membership

	private void handleJoin(ClientConnection connection, RolePreference rolePref) {
		pendingJoins.decrementAndGet();
		if (members.containsKey(connection)) {
			return;
		}
		Member member = new Member(connection, rolePref);
		members.put(connection, member);
		connection.send(new ServerMessages.Welcome(connection.playerId(), id, rules.tickRate(), tick, mapData));
		log.info("Player {} joined room {} ({} members)", connection.playerId(), id, members.size());
		if (phase == Phase.PLAYING) {
			seatMidMatch(member);
			sendMatchStatus(member);
		}
		markLobbyDirty();
	}

	/** Reclaims a reserved seat, else takes over a bot of the preferred role, else spectates. */
	private void seatMidMatch(Member member) {
		ReservedSeat seat = reservedSeats.remove(member.connection.playerId());
		Optional<Actor> reclaimed = Optional.ofNullable(seat)
				.flatMap(s -> match.actor(s.actorId()))
				.filter(actor -> actor.health().isInPlay());
		if (reclaimed.isPresent()) {
			takeControl(member, reclaimed.get(), "reconnected");
			return;
		}
		match.actors().stream()
				.filter(actor -> actor.health().isInPlay() && controllers.get(actor.id()) instanceof BotControl)
				.filter(actor -> !isReserved(actor.id()))
				.filter(actor -> member.rolePref.accepts(actor.role()))
				.min(Comparator.comparingInt(Actor::id))
				.ifPresentOrElse(actor -> takeControl(member, actor, "took over a bot"),
						() -> member.connection.send(new ServerMessages.Takeover(null, "spectating")));
	}

	private boolean isReserved(int actorId) {
		return reservedSeats.values().stream().anyMatch(seat -> seat.actorId() == actorId);
	}

	private void takeControl(Member member, Actor actor, String reason) {
		seat(member, actor);
		member.connection.send(new ServerMessages.Takeover(actor.id(), reason));
		log.info("Player {} controls entity {} in room {} ({})", member.connection.playerId(), actor.id(), id, reason);
	}

	private void handleLeave(ClientConnection connection) {
		Member member = members.remove(connection);
		if (member == null) {
			return;
		}
		if (phase == Phase.PLAYING && member.actorId != null) {
			Actor actor = match.actor(member.actorId).orElseThrow();
			actor.assignController(null, true);
			controllers.put(actor.id(), new BotControl(new Bot(botDifficulty, random.nextLong())));
			if (actor.health().isInPlay()) {
				reservedSeats.put(connection.playerId(),
						new ReservedSeat(actor.id(), tick + rules.ticks(RECONNECT_GRACE_SECONDS)));
			}
		}
		log.info("Player {} left room {} ({} members)", connection.playerId(), id, members.size());
		markLobbyDirty();
	}

	private void handleInput(ClientConnection connection, Input input) {
		Member member = members.get(connection);
		if (member == null || member.actorId == null
				|| !(controllers.get(member.actorId) instanceof HumanControl control)) {
			return;
		}
		PlayerInput playerInput = new PlayerInput(input.seq(), input.dx(), input.dy(), input.sprint(),
				input.interact(), input.actions());
		boolean stale = playerInput.seq() <= control.lastAppliedSeq
				|| (!control.pending.isEmpty() && playerInput.seq() <= control.pending.peekLast().seq());
		if (stale) {
			return;
		}
		control.pending.addLast(playerInput);
		while (control.pending.size() > MAX_PENDING_INPUTS) {
			control.pending.removeFirst();
		}
	}

	// ---------------------------------------------------------------- lobby

	private void tickLobby() {
		if (members.isEmpty()) {
			countdownTicks = -1;
			return;
		}
		if (countdownTicks < 0) {
			countdownTicks = rules.ticks(rules.match().lobbyCountdownSeconds());
			markLobbyDirty();
		}
		if (members.size() >= CAPACITY) {
			countdownTicks = Math.min(countdownTicks, rules.ticks(rules.match().fullLobbyCountdownSeconds()));
		}
		if (--countdownTicks <= 0) {
			startMatch();
			return;
		}
		if (tick >= nextStatusTick || members.values().stream().anyMatch(m -> m.lobbyDirty)) {
			sendLobbyStatus();
		}
	}

	private void sendLobbyStatus() {
		long startsInMs = Math.max(0, countdownTicks) * 1000 / rules.tickRate();
		for (Member recipient : members.values()) {
			List<ServerMessages.LobbySlot> slots = members.values().stream()
					.map(m -> new ServerMessages.LobbySlot(m.connection.displayName(), m.rolePref.wireName(), false,
							m == recipient))
					.toList();
			recipient.connection.send(new ServerMessages.Lobby(id, slots, CAPACITY, startsInMs));
			recipient.lobbyDirty = false;
		}
		nextStatusTick = tick + rules.ticks(STATUS_BROADCAST_SECONDS);
	}

	private void markLobbyDirty() {
		members.values().forEach(member -> member.lobbyDirty = true);
	}

	// ---------------------------------------------------------------- match

	private void startMatch() {
		match = new Match(map, rules, random.nextLong());
		matchStartedAt = Instant.now();
		controllers.clear();
		owners.clear();
		reservedSeats.clear();

		List<Member> humans = new ArrayList<>(members.values());
		Collections.shuffle(humans, random);
		Member monsterPlayer = humans.stream().filter(m -> m.rolePref == RolePreference.MONSTER).findFirst()
				.or(() -> humans.stream().filter(m -> m.rolePref == RolePreference.ANY).findFirst())
				.orElse(null);

		if (monsterPlayer != null) {
			seat(monsterPlayer, match.addActor(Role.MONSTER, monsterPlayer.connection.displayName(), MONSTER_GLYPH,
					MONSTER_COLOR));
		}
		else {
			addBot(Role.MONSTER, BOT_MONSTER_NAME, MONSTER_GLYPH, MONSTER_COLOR);
		}
		int survivorSlot = 0;
		for (Member member : humans) {
			if (member == monsterPlayer) {
				continue;
			}
			if (survivorSlot >= rules.match().survivorSlots()) {
				member.actorId = null;
				member.connection.send(new ServerMessages.Takeover(null, "spectating"));
				continue;
			}
			PlayerIdentity identity = member.connection.identity();
			String glyph = identity.authenticated() ? identity.glyph() : SURVIVOR_GLYPH;
			String color = identity.authenticated() ? identity.color() : SURVIVOR_COLORS.get(survivorSlot);
			seat(member, match.addActor(Role.SURVIVOR, identity.displayName(), glyph, color));
			survivorSlot++;
		}
		for (; survivorSlot < rules.match().survivorSlots(); survivorSlot++) {
			addBot(Role.SURVIVOR, BOT_SURVIVOR_NAMES.get(survivorSlot) + " (bot)", SURVIVOR_GLYPH,
					SURVIVOR_COLORS.get(survivorSlot));
		}
		phase = Phase.PLAYING;
		nextStatusTick = tick;
		log.info("Room {} started a match with {} players", id, humans.size());
	}

	private void seat(Member member, Actor actor) {
		member.actorId = actor.id();
		actor.assignController(member.connection.playerId(), false);
		controllers.put(actor.id(), new HumanControl());
		owners.put(actor.id(), member.connection.identity());
	}

	private void addBot(Role role, String name, String glyph, String color) {
		Actor actor = match.addActor(role, name, glyph, color);
		actor.assignController(null, true);
		controllers.put(actor.id(), new BotControl(new Bot(botDifficulty, random.nextLong())));
	}

	private void tickMatch() {
		Map<Integer, PlayerInput> inputs = new HashMap<>();
		controllers.forEach((actorId, controller) -> {
			Actor actor = match.actor(actorId).orElseThrow();
			PlayerInput input = switch (controller) {
				case HumanControl human -> {
					PlayerInput next = human.pending.pollFirst();
					if (next != null) {
						human.lastAppliedSeq = next.seq();
					}
					yield next;
				}
				case BotControl bot -> actor.health().isInPlay() ? bot.bot().nextInput(match, actor) : null;
			};
			if (input != null) {
				inputs.put(actorId, input);
			}
		});
		match.tick(inputs);
		List<MatchEvent> events = match.drainEvents();
		events.forEach(event -> broadcast(new ServerMessages.Event(event.kind(), eventData(event))));
		sendSnapshots();
		if (!events.isEmpty() || tick >= nextStatusTick) {
			members.values().forEach(this::sendMatchStatus);
			nextStatusTick = tick + rules.ticks(STATUS_BROADCAST_SECONDS);
		}
		if (match.phase() == Match.Phase.FINISHED) {
			finishMatch();
		}
	}

	private static Map<String, Object> eventData(MatchEvent event) {
		return switch (event) {
			case MatchEvent.Hit hit -> Map.of("attackerId", hit.attackerId(), "victimId", hit.victimId());
			case MatchEvent.Downed downed -> Map.of("victimId", downed.victimId());
			case MatchEvent.Caught caught -> caught.byId() == null ? Map.of("victimId", caught.victimId())
					: Map.of("victimId", caught.victimId(), "byId", caught.byId());
			case MatchEvent.Revived revived -> Map.of("victimId", revived.victimId(), "byId", revived.byId());
			case MatchEvent.Escaped escaped -> Map.of("survivorId", escaped.survivorId());
			case MatchEvent.GeneratorDone done -> Map.of("generatorId", done.generatorId(), "x", done.at().x(),
					"y", done.at().y());
			case MatchEvent.GateOpened opened -> Map.of();
			case MatchEvent.Sonar sonar -> Map.of("monsterId", sonar.monsterId());
			case MatchEvent.TrapTriggered trap -> Map.of("victimId", trap.victimId());
			case MatchEvent.SkillCheck check -> Map.of("survivorId", check.survivorId(), "success", check.success());
		};
	}

	private void sendSnapshots() {
		List<ServerMessages.BotDebugView> botDebug = botDebugView ? botDebug() : null;
		for (Member member : members.values()) {
			Optional<Actor> viewer = viewerFor(member);
			if (viewer.isEmpty()) {
				continue;
			}
			boolean ownActor = member.actorId != null && member.actorId == viewer.get().id();
			long ackSeq = ownActor && controllers.get(member.actorId) instanceof HumanControl human
					? human.lastAppliedSeq : 0;
			member.connection.send(SnapshotBuilder.build(match, viewer.get(), tick, ackSeq, !ownActor, botDebug));
		}
	}

	private List<ServerMessages.BotDebugView> botDebug() {
		List<ServerMessages.BotDebugView> views = new ArrayList<>();
		controllers.forEach((actorId, controller) -> {
			if (controller instanceof BotControl(Bot bot)) {
				Bot.DebugInfo info = bot.debugInfo();
				views.add(new ServerMessages.BotDebugView(actorId, info.state(), info.path().stream()
						.map(cell -> new ServerMessages.CellView(cell.x(), cell.y()))
						.toList()));
			}
		});
		return views;
	}

	/** Own actor while in play, else the first survivor still in play (spectator view), else the monster. */
	private Optional<Actor> viewerFor(Member member) {
		if (member.actorId != null) {
			Actor own = match.actor(member.actorId).orElseThrow();
			if (own.health().isInPlay()) {
				return Optional.of(own);
			}
		}
		return match.actors().stream().filter(a -> a.role() == Role.SURVIVOR && a.health().isInPlay()).findFirst()
				.or(match::monster);
	}

	private void sendMatchStatus(Member member) {
		Actor own = member.actorId == null ? null : match.actor(member.actorId).orElse(null);
		Integer spectating = viewerFor(member).filter(viewer -> viewer != own).map(Actor::id).orElse(null);
		List<ServerMessages.RosterEntry> roster = match.actors().stream()
				.map(a -> new ServerMessages.RosterEntry(a.id(), a.role().wireName(), a.name(), a.bot(),
						a.health().wireName()))
				.toList();
		member.connection.send(new ServerMessages.MatchStatus(
				match.phase() == Match.Phase.ENDGAME ? "endgame" : "playing",
				own == null ? null : own.role().wireName(),
				own == null ? null : own.id(),
				spectating,
				match.generators().size(), rules.match().generatorsNeeded(), match.generatorsDone(), match.gateOpen(),
				match.ticksLeft() * 1000L / rules.tickRate(), roster));
	}

	private void finishMatch() {
		String winner = match.winner().orElse(Match.Winner.MONSTER) == Match.Winner.SURVIVORS ? "survivors"
				: "monster";
		List<ServerMessages.PlayerResult> results = match.actors().stream()
				.map(a -> new ServerMessages.PlayerResult(a.id(), a.name(), a.role().wireName(), a.bot(),
						a.health() == Health.ESCAPED, a.health() == Health.CAUGHT,
						Math.round(a.stats().generatorWork() * 100) / 100.0, a.stats().hits(), a.stats().downs(),
						a.stats().catches(), a.stats().revives(), a.stats().score()))
				.toList();
		resultTicks = rules.ticks(rules.match().resultSeconds());
		broadcast(new ServerMessages.Result(winner, results, resultTicks * 1000 / rules.tickRate()));
		matchSink.accept(matchRecord(winner));
		phase = Phase.RESULT;
		log.info("Room {} match finished: {} win", id, winner);
	}

	private MatchRecord matchRecord(String winner) {
		List<MatchRecord.Participant> participants = match.actors().stream()
				.map(actor -> {
					PlayerIdentity owner = owners.get(actor.id());
					boolean won = (actor.role() == Role.MONSTER) == "monster".equals(winner);
					return new MatchRecord.Participant(owner == null ? null : owner.userId(), owner == null,
							actor.role().wireName(), actor.health() == Health.ESCAPED,
							actor.health() == Health.CAUGHT, actor.stats().generatorsCompleted(),
							actor.stats().hits(), actor.stats().downs(), actor.stats().score(), won);
				})
				.toList();
		return new MatchRecord(id, map.id(), matchStartedAt, Instant.now(), winner, participants);
	}

	private void tickResult() {
		if (--resultTicks > 0) {
			return;
		}
		phase = Phase.LOBBY;
		match = null;
		controllers.clear();
		owners.clear();
		reservedSeats.clear();
		countdownTicks = -1;
		members.values().forEach(member -> member.actorId = null);
		markLobbyDirty();
	}

	// ---------------------------------------------------------------- misc

	private void publishStatus() {
		boolean botMonster = false;
		boolean botSurvivor = false;
		if (phase == Phase.PLAYING) {
			for (Map.Entry<Integer, Controller> entry : controllers.entrySet()) {
				Actor actor = match.actor(entry.getKey()).orElseThrow();
				if (entry.getValue() instanceof BotControl && actor.health().isInPlay() && !isReserved(actor.id())) {
					botMonster |= actor.role() == Role.MONSTER;
					botSurvivor |= actor.role() == Role.SURVIVOR;
				}
			}
		}
		int count = members.size();
		if (count == 0 && status.members() > 0) {
			emptySinceNanos = System.nanoTime();
		}
		status = new Status(phase, count, botMonster, botSurvivor, Set.copyOf(reservedSeats.keySet()));
	}

	private void broadcast(ServerMessage message) {
		members.keySet().forEach(connection -> connection.send(message));
	}
}
