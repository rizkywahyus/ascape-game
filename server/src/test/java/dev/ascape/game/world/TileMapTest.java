package dev.ascape.game.world;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class TileMapTest {

	@Test
	void parsesDimensionsAndIgnoresTrailingBlankLines() {
		TileMap map = TileMap.parse("t", "####\n#S.#\n####\n\n", TestMaps.LEGEND);

		assertThat(map.width()).isEqualTo(4);
		assertThat(map.height()).isEqualTo(3);
		assertThat(map.findAll(TileKind.SURVIVOR_SPAWN)).containsExactly(new GridPos(1, 1));
	}

	@Test
	void acceptsCrlf() {
		assertThat(TileMap.parse("t", "###\r\n#S#\r\n###", TestMaps.LEGEND).height()).isEqualTo(3);
	}

	@Test
	void rejectsRaggedRows() {
		assertThatThrownBy(() -> TestMaps.of("####", "#S#", "####"))
				.hasMessageContaining("row 2 has width 3, expected 4");
	}

	@Test
	void rejectsUnknownCharacters() {
		assertThatThrownBy(() -> TestMaps.of("###", "#x#", "###"))
				.hasMessageContaining("unknown character 'x' at row 2, column 2");
	}

	@Test
	void treatsOutsideAsWall() {
		TileMap map = TestMaps.of("#S#");

		assertThat(map.isSolid(-1, 0)).isTrue();
		assertThat(map.isSolid(1, 5)).isTrue();
		assertThat(map.isSolid(1, 0)).isFalse();
	}
}
