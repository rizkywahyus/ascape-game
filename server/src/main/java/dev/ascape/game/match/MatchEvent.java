package dev.ascape.game.match;

import dev.ascape.game.world.GridPos;

/** Something notable that happened during a tick; forwarded to clients as {@code event} messages. */
public sealed interface MatchEvent {

	String kind();

	record Hit(int attackerId, int victimId, GridPos at) implements MatchEvent {
		public String kind() {
			return "hit";
		}
	}

	record Downed(int victimId, GridPos at) implements MatchEvent {
		public String kind() {
			return "downed";
		}
	}

	record Caught(int victimId, Integer byId) implements MatchEvent {
		public String kind() {
			return "caught";
		}
	}

	record Revived(int victimId, int byId) implements MatchEvent {
		public String kind() {
			return "revive";
		}
	}

	record Escaped(int survivorId) implements MatchEvent {
		public String kind() {
			return "escaped";
		}
	}

	record GeneratorDone(int generatorId, GridPos at) implements MatchEvent {
		public String kind() {
			return "generator_done";
		}
	}

	record GateOpened() implements MatchEvent {
		public String kind() {
			return "gate_open";
		}
	}

	record Sonar(int monsterId) implements MatchEvent {
		public String kind() {
			return "sonar";
		}
	}

	record TrapTriggered(int victimId, GridPos at) implements MatchEvent {
		public String kind() {
			return "trap";
		}
	}

	record SkillCheck(int survivorId, int generatorId, boolean success) implements MatchEvent {
		public String kind() {
			return "skill_check";
		}
	}
}
