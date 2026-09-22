package dev.ascape.game.bot;

import java.util.Random;

import dev.ascape.game.world.Walkability;

/** Decides what a bot wants, from its perception only, and steers the navigator accordingly. */
interface Brain {

	Intent think(Perception perception, Navigator navigator, Walkability walkability, Random random);

	/** Current state or goal, for the debug view. */
	String describe();
}
