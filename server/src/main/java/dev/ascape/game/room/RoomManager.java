package dev.ascape.game.room;

import java.util.Collection;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import dev.ascape.config.AscapeProperties;
import dev.ascape.game.bot.Difficulty;
import dev.ascape.game.rules.GameRules;
import dev.ascape.game.world.TileMap;
import dev.ascape.net.ClientConnection;
import dev.ascape.player.PlayerStore;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

/**
 * Owns all rooms: creates them on demand, matchmakes {@code queue} requests and removes rooms that have been
 * empty for a while.
 */
@Component
public class RoomManager implements DisposableBean {

	private static final Logger log = LoggerFactory.getLogger(RoomManager.class);
	private static final Pattern ROOM_ID = Pattern.compile("[a-z0-9-]{1,32}");
	private static final long IDLE_ROOM_NANOS = TimeUnit.SECONDS.toNanos(30);
	private static final long SWEEP_INTERVAL_SECONDS = 10;
	private static final String MATCHMADE_ROOM_PREFIX = "m-";
	private static final int ROOM_ID_BYTES = 3;

	private final ConcurrentMap<String, GameRoom> rooms = new ConcurrentHashMap<>();
	private final TileMap map;
	private final GameRules rules;
	private final PlayerStore players;
	private final Difficulty botDifficulty;
	private final boolean botDebugView;
	private final RoomMetrics metrics;
	private final Random seeds = new Random();
	private final ScheduledExecutorService sweeper = Executors.newSingleThreadScheduledExecutor(
			Thread.ofPlatform().name("room-sweeper").daemon().factory());

	public RoomManager(TileMap map, GameRules rules, PlayerStore players, Difficulty botDifficulty,
			AscapeProperties properties, MeterRegistry registry) {
		this.map = map;
		this.botDebugView = properties.debug().botView();
		if (botDebugView) {
			log.warn("Bot debug view enabled: every client receives bot positions and paths");
		}
		this.rules = rules;
		this.players = players;
		this.botDifficulty = botDifficulty;
		this.metrics = new RoomMetrics(registry);
		Gauge.builder("ascape.rooms", rooms, ConcurrentMap::size).register(registry);
		Gauge.builder("ascape.players", rooms, r -> r.values().stream().mapToInt(GameRoom::playerCount).sum())
				.register(registry);
		sweeper.scheduleWithFixedDelay(this::removeIdleRooms, SWEEP_INTERVAL_SECONDS, SWEEP_INTERVAL_SECONDS,
				TimeUnit.SECONDS);
	}

	public static boolean isValidRoomId(String roomId) {
		return roomId != null && ROOM_ID.matcher(roomId).matches();
	}

	public RoomMetrics metrics() {
		return metrics;
	}

	public Collection<GameRoom> rooms() {
		return List.copyOf(rooms.values());
	}

	/**
	 * Matchmaking. In order of preference: the room holding this player's seat after a disconnect; a running match
	 * with a bot in the wanted role (drop-in); a lobby with space; a new room.
	 * Synchronized so two players cannot both be counted into the last free slot.
	 */
	public synchronized String queue(ClientConnection connection, RolePreference rolePref) {
		String playerId = connection.playerId();
		Optional<GameRoom> target = rooms.values().stream()
				.filter(room -> room.status().reservedPlayerIds().contains(playerId))
				.findFirst()
				.or(() -> openRooms()
						.filter(room -> room.status().phase() == GameRoom.Phase.PLAYING)
						.filter(room -> botSeatFor(room.status(), rolePref))
						.max(Comparator.comparingInt(GameRoom::playerCount)))
				.or(() -> openRooms()
						.filter(room -> room.status().phase() == GameRoom.Phase.LOBBY)
						.max(Comparator.comparingInt(GameRoom::playerCount)));
		String roomId = target.map(GameRoom::id).orElseGet(RoomManager::newRoomId);
		join(connection, roomId, rolePref);
		return roomId;
	}

	/** Moves the connection into {@code roomId}, creating the room if needed and leaving any previous room. */
	public void join(ClientConnection connection, String roomId, RolePreference rolePref) {
		if (!isValidRoomId(roomId)) {
			throw new IllegalArgumentException("Invalid room id");
		}
		leave(connection);
		// Enqueue the join inside compute() so the sweeper, which also uses compute(), can never remove
		// a room between us picking it and the join being registered.
		rooms.compute(roomId, (id, room) -> {
			GameRoom target = room != null ? room : createRoom(id);
			// Set before the join is processed so a disconnect racing the join still reaches this room.
			connection.setRoom(target);
			target.submitJoin(connection, rolePref);
			return target;
		});
		if (connection.identity().authenticated()) {
			players.recordJoin(connection.identity().userId(), roomId);
		}
	}

	public void leave(ClientConnection connection) {
		GameRoom previous = connection.room();
		if (previous != null) {
			previous.submitLeave(connection);
			connection.setRoom(null);
		}
	}

	private java.util.stream.Stream<GameRoom> openRooms() {
		return rooms.values().stream()
				.filter(room -> room.id().startsWith(MATCHMADE_ROOM_PREFIX))
				// A held lobby is waiting for friends with the room code; keep strangers out of it.
				.filter(room -> !room.status().held())
				.filter(room -> room.playerCount() + room.pendingJoins() < GameRoom.CAPACITY);
	}

	private static boolean botSeatFor(GameRoom.Status status, RolePreference rolePref) {
		return switch (rolePref) {
			case MONSTER -> status.botMonster();
			case SURVIVOR -> status.botSurvivor();
			case ANY -> status.botMonster() || status.botSurvivor();
		};
	}

	private static String newRoomId() {
		byte[] random = new byte[ROOM_ID_BYTES];
		ThreadLocalRandom.current().nextBytes(random);
		return MATCHMADE_ROOM_PREFIX + HexFormat.of().formatHex(random);
	}

	private GameRoom createRoom(String roomId) {
		GameRoom room = new GameRoom(roomId, map, rules, botDifficulty, botDebugView, metrics, players::saveMatch,
				seeds.nextLong());
		room.start();
		log.info("Created room {}", roomId);
		return room;
	}

	private void removeIdleRooms() {
		long now = System.nanoTime();
		rooms.keySet().forEach(roomId -> rooms.computeIfPresent(roomId, (id, room) -> {
			if (!room.isIdleFor(IDLE_ROOM_NANOS, now)) {
				return room;
			}
			room.stop();
			log.info("Removed idle room {}", id);
			return null;
		}));
	}

	@Override
	public void destroy() {
		sweeper.shutdownNow();
		rooms.values().forEach(GameRoom::stop);
	}
}
