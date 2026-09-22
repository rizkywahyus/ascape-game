package dev.ascape.game.bot;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.LongStream;

import dev.ascape.game.TestRules;
import dev.ascape.game.match.Actor;
import dev.ascape.game.match.Health;
import dev.ascape.game.match.Match;
import dev.ascape.game.match.PlayerInput;
import dev.ascape.game.match.Role;
import dev.ascape.game.world.SharedMaps;
import dev.ascape.game.world.TileMap;
import org.junit.jupiter.api.Test;

/**
 * Whole matches played by bots only on the real map. Everything is seeded, so results are deterministic; the
 * assertions double as a balance regression guard (both sides must be able to win).
 */
class BotMatchSimulationTest {

	private static final TileMap MANOR = SharedMaps.load("manor");
	private static final int SEEDS = 10;

	private record Outcome(Match.Winner winner, int seconds, int generatorsDone, double generatorWork, int hits,
			int catches, long escaped, double microsPerTick) {
	}

	@Test
	void botsPlayFullMatchesThatBothSidesCanWin() {
		List<Outcome> outcomes = new ArrayList<>();
		LongStream.rangeClosed(1, SEEDS).forEach(seed -> outcomes.add(play(seed)));
		outcomes.forEach(o -> System.out.printf("%s after %ds: generators %d (work %.1f), hits %d, catches %d, "
				+ "escaped %d, %.0f µs/tick%n", o.winner(), o.seconds(), o.generatorsDone(), o.generatorWork(), o.hits(),
				o.catches(), o.escaped(), o.microsPerTick()));

		assertThat(outcomes).as("survivors can win").anyMatch(o -> o.winner() == Match.Winner.SURVIVORS);
		assertThat(outcomes).as("the monster can win").anyMatch(o -> o.winner() == Match.Winner.MONSTER);
		assertThat(outcomes.stream().mapToInt(Outcome::hits).sum()).as("the monster hunts").isGreaterThan(SEEDS);
		assertThat(outcomes.stream().mapToDouble(Outcome::generatorWork).average().orElseThrow())
				.as("survivors repair").isGreaterThan(2);
		assertThat(outcomes).as("5 bots + simulation fit easily in a 50 ms tick")
				.allMatch(o -> o.microsPerTick() < 5_000);
	}

	private static Outcome play(long seed) {
		Match match = new Match(MANOR, TestRules.RULES, seed);
		Map<Actor, Bot> bots = new HashMap<>();
		bots.put(match.addActor(Role.MONSTER, "monster", "M", "#c0392b"), new Bot(Difficulty.NORMAL, seed));
		for (int i = 0; i < 4; i++) {
			bots.put(match.addActor(Role.SURVIVOR, "s" + i, "@", "#ffffff"), new Bot(Difficulty.NORMAL, seed * 10 + i));
		}
		int maxTicks = TestRules.RULES.ticks(TestRules.RULES.match().durationSeconds()
				+ TestRules.RULES.match().endgameCollapseSeconds()) + 1;
		long start = System.nanoTime();
		int ticks = 0;
		while (match.phase() != Match.Phase.FINISHED && ticks++ < maxTicks) {
			Map<Integer, PlayerInput> inputs = new HashMap<>();
			bots.forEach((actor, bot) -> {
				if (actor.health().isInPlay()) {
					inputs.put(actor.id(), bot.nextInput(match, actor));
				}
			});
			match.tick(inputs);
		}
		assertThat(match.phase()).as("seed %d finishes", seed).isEqualTo(Match.Phase.FINISHED);

		List<Actor> survivors = match.actors().stream().filter(a -> a.role() == Role.SURVIVOR).toList();
		Actor monster = match.monster().orElseThrow();
		return new Outcome(match.winner().orElseThrow(), ticks / TestRules.RULES.tickRate(), match.generatorsDone(),
				survivors.stream().mapToDouble(s -> s.stats().generatorWork()).sum(), monster.stats().hits(),
				monster.stats().catches(), survivors.stream().filter(s -> s.health() == Health.ESCAPED).count(),
				(System.nanoTime() - start) / 1_000.0 / ticks);
	}
}
