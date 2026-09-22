package dev.ascape.game;

import java.nio.file.Path;

import dev.ascape.game.rules.GameRules;
import tools.jackson.databind.json.JsonMapper;

/** The real shared/rules.json, so tests exercise the tuned values. */
public final class TestRules {

	public static final GameRules RULES = JsonMapper.builder().build()
			.readValue(Path.of("../shared/rules.json").toFile(), GameRules.class);

	private TestRules() {
	}
}
