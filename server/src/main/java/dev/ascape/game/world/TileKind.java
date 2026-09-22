package dev.ascape.game.world;

import com.fasterxml.jackson.annotation.JsonProperty;

public enum TileKind {
	@JsonProperty("wall") WALL,
	@JsonProperty("floor") FLOOR,
	@JsonProperty("survivorSpawn") SURVIVOR_SPAWN,
	@JsonProperty("monsterSpawn") MONSTER_SPAWN,
	@JsonProperty("generator") GENERATOR,
	@JsonProperty("generatorFrame") GENERATOR_FRAME,
	@JsonProperty("gate") GATE,
	@JsonProperty("locker") LOCKER
}
