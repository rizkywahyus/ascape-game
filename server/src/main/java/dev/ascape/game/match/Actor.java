package dev.ascape.game.match;

import dev.ascape.game.world.GridPos;
import dev.ascape.game.world.Movement.MoveState;

/** A survivor or the monster in a {@link Match}. Mutated only on its room's thread. */
public final class Actor {

	/** What an actor is channelling this tick, for the HUD progress bar. */
	public enum Activity {
		NONE, REPAIR, REVIVE, HEAL, CATCH
	}

	/** Per-match numbers used for scoring and persistence. */
	public static final class Stats {
		int hits;
		int downs;
		int catches;
		int revives;
		int heals;
		int hitsTaken;
		/** Generator progress contributed, in whole generators (1.0 = one generator). */
		double generatorWork;
		int generatorsCompleted;
		int score;

		public int hits() {
			return hits;
		}

		public int downs() {
			return downs;
		}

		public int catches() {
			return catches;
		}

		public int revives() {
			return revives;
		}

		public int heals() {
			return heals;
		}

		public double generatorWork() {
			return generatorWork;
		}

		public int generatorsCompleted() {
			return generatorsCompleted;
		}

		public int score() {
			return score;
		}
	}

	final int id;
	final Role role;
	final String name;
	final String glyph;
	final String color;
	/** Who controls this character; swapped on bot takeover without touching the simulation. */
	String playerId;
	boolean bot;

	MoveState move;
	int facingDx = 1;
	int facingDy;
	Health health = Health.HEALTHY;
	double stamina;
	int staminaRegenDelayTicks;
	boolean flashlightOn = true;
	int rocks;
	Locker hiddenIn;
	GridPos hiddenFrom;
	boolean interactHeld;
	Activity activity = Activity.NONE;
	double activityProgress;

	int trappedTicks;
	int hitBoostTicks;
	int bleedOutTicks;
	double reviveProgress;
	double healProgress;
	/** Monster: progress of carrying off the downed survivor next to it. */
	double catchProgress;
	int attackCooldownTicks;
	int attackSlowTicks;
	int lungeTicks;
	int lungeCooldownTicks;
	int sonarTicks;
	int sonarCooldownTicks;
	int trapCooldownTicks;
	/** Attack pressed during cooldown; it fires when the cooldown ends, if before this tick. */
	int attackBufferedUntilTick = -1;
	long bufferedAttackViewTick;
	/** Recent positions by tick, for lag-compensated hit checks (see Match.attack). */
	final GridPos[] positionHistory = new GridPos[Match.POSITION_HISTORY_TICKS];
	int skillCheckStartTick = -1;
	int skillCheckDeadlineTick = -1;
	int skillCheckGeneratorId;

	final Stats stats = new Stats();

	Actor(int id, Role role, String name, String glyph, String color, GridPos spawn) {
		this.id = id;
		this.role = role;
		this.name = name;
		this.glyph = glyph;
		this.color = color;
		this.move = new MoveState(spawn, 1.0);
	}

	public int id() {
		return id;
	}

	public Role role() {
		return role;
	}

	public String name() {
		return name;
	}

	public String glyph() {
		return glyph;
	}

	public String color() {
		return color;
	}

	public String playerId() {
		return playerId;
	}

	public boolean bot() {
		return bot;
	}

	public GridPos position() {
		return move.position();
	}

	public double moveProgress() {
		return move.progress();
	}

	public Health health() {
		return health;
	}

	public double stamina() {
		return stamina;
	}

	public boolean flashlightOn() {
		return flashlightOn;
	}

	public boolean hidden() {
		return hiddenIn != null;
	}

	public int rocks() {
		return rocks;
	}

	public Activity activity() {
		return activity;
	}

	public double activityProgress() {
		return activityProgress;
	}

	public boolean trapped() {
		return trappedTicks > 0;
	}

	public int attackCooldownTicks() {
		return attackCooldownTicks;
	}

	public int lungeCooldownTicks() {
		return lungeCooldownTicks;
	}

	public int sonarCooldownTicks() {
		return sonarCooldownTicks;
	}

	public int trapCooldownTicks() {
		return trapCooldownTicks;
	}

	public boolean sonarActive() {
		return sonarTicks > 0;
	}

	public int bleedOutTicks() {
		return bleedOutTicks;
	}

	public boolean skillCheckPending() {
		return skillCheckDeadlineTick >= 0;
	}

	public int skillCheckStartTick() {
		return skillCheckStartTick;
	}

	public int skillCheckDeadlineTick() {
		return skillCheckDeadlineTick;
	}

	public Stats stats() {
		return stats;
	}

	public void assignController(String playerId, boolean bot) {
		this.playerId = playerId;
		this.bot = bot;
	}
}
