package dev.ascape.game.rules;

/**
 * Gameplay constants shared with the client via {@code shared/rules.json}. Durations are in seconds and
 * speeds in cells per second; {@link #ticks(double)} converts durations to ticks.
 */
public record GameRules(int tickRate, MatchRules match, SurvivorRules survivor, MonsterRules monster,
		SoundRules sound, TrailRules trail) {

	public record MatchRules(double lobbyCountdownSeconds, double fullLobbyCountdownSeconds, double durationSeconds,
			double endgameCollapseSeconds, double resultSeconds, int generatorsNeeded, int survivorSlots) {
	}

	public record SurvivorRules(double walkSpeed, double sprintSpeed, double hitBoostSpeed, double hitBoostSeconds,
			double downedCrawlSpeed, double staminaMax, double sprintDrainPerSecond, double staminaRegenPerSecond,
			double staminaRegenDelaySeconds, double bleedOutSeconds, double reviveSeconds, double healSeconds,
			double repairSecondsSolo,
			double extraRepairerEfficiency, int flashlightRadius, int darkRadius, int rocks, int rockThrowDistance,
			int senseMonsterRadius) {
	}

	public record MonsterRules(double walkSpeed, int attackRange, double attackHitCooldownSeconds,
			double attackMissCooldownSeconds,
			double attackSlowSeconds, double attackSlowSpeed, double catchSeconds, int visionRadius, int lightSpotRadius,
			int trailSpotRadius, double lungeSpeed, double lungeSeconds, double lungeCooldownSeconds, int sonarRadius,
			double sonarSeconds, double sonarCooldownSeconds, int maxTraps, double trapCooldownSeconds,
			double trapStunSeconds, int terrorRadius, int hearingRadius) {
	}

	public record SoundRules(int sprintRadius, int repairRadius, int lockerRadius, int rockRadius, int trapRadius,
			int hitRadius, double lifetimeSeconds) {
	}

	public record TrailRules(double lifetimeSeconds) {
	}

	public GameRules {
		if (tickRate <= 0) {
			throw new IllegalArgumentException("tickRate must be positive, was " + tickRate);
		}
	}

	public GameRules withLobbyCountdown(double seconds) {
		MatchRules m = match;
		return new GameRules(tickRate, new MatchRules(seconds, Math.min(seconds, m.fullLobbyCountdownSeconds()),
				m.durationSeconds(), m.endgameCollapseSeconds(), m.resultSeconds(), m.generatorsNeeded(),
				m.survivorSlots()), survivor, monster, sound, trail);
	}

	/** Duration in whole ticks (at least 1 for positive durations). */
	public int ticks(double seconds) {
		return seconds <= 0 ? 0 : Math.max(1, (int) Math.round(seconds * tickRate));
	}

	/** Seconds per tick. */
	public double tickSeconds() {
		return 1.0 / tickRate;
	}
}
