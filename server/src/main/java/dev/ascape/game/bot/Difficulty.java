package dev.ascape.game.bot;

/**
 * How sharp a bot is. {@code reactionTicks}: delay before a bot acts on what it perceives;
 * {@code perceptionScale}: fraction of the fair perception radius it actually uses;
 * {@code skillCheckAccuracy}: chance to hit a skill check; {@code blunderChance}: per-decision chance to act randomly.
 */
public enum Difficulty {
	EASY(6, 0.7, 0.55, 0.12),
	NORMAL(4, 0.75, 0.8, 0.05),
	HARD(1, 1.0, 0.95, 0.01);

	final int reactionTicks;
	final double perceptionScale;
	final double skillCheckAccuracy;
	final double blunderChance;

	Difficulty(int reactionTicks, double perceptionScale, double skillCheckAccuracy, double blunderChance) {
		this.reactionTicks = reactionTicks;
		this.perceptionScale = perceptionScale;
		this.skillCheckAccuracy = skillCheckAccuracy;
		this.blunderChance = blunderChance;
	}
}
