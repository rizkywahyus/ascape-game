package dev.ascape.game.room;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import dev.ascape.game.match.PlayerInput;
import org.junit.jupiter.api.Test;

class InputQueueTest {

	private static PlayerInput move(long seq, String... actions) {
		return new PlayerInput(seq, 1, 0, false, false, List.of(actions));
	}

	@Test
	void consumesInOrderAndTracksTheAck() {
		InputQueue queue = new InputQueue();
		queue.add(move(1));
		queue.add(move(2));

		assertThat(queue.poll().seq()).isEqualTo(1);
		assertThat(queue.lastAppliedSeq()).isEqualTo(1);
		assertThat(queue.poll().seq()).isEqualTo(2);
		assertThat(queue.poll()).isNull();
	}

	@Test
	void ignoresDuplicatesAndOutOfOrderInputs() {
		InputQueue queue = new InputQueue();
		queue.add(move(2));
		queue.add(move(1));
		queue.add(move(2));
		assertThat(queue.size()).isEqualTo(1);
	}

	@Test
	void aBurstCannotLeaveAPermanentBacklog() {
		InputQueue queue = new InputQueue();
		for (long seq = 1; seq <= 10; seq++) {
			queue.add(move(seq));
		}
		assertThat(queue.size()).isEqualTo(InputQueue.MAX_BACKLOG);
		assertThat(queue.poll().seq()).isEqualTo(8);
	}

	@Test
	void trimmedInputsKeepTheirPresses() {
		InputQueue queue = new InputQueue();
		queue.add(move(1, PlayerInput.ATTACK));
		queue.add(move(2));
		queue.add(move(3));
		queue.add(move(4)); // trims seq 1, whose attack must survive

		PlayerInput next = queue.poll();
		assertThat(next.seq()).isEqualTo(2);
		assertThat(next.has(PlayerInput.ATTACK)).isTrue();
	}
}
