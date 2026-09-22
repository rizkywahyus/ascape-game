package dev.ascape.game.world;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Immutable grid parsed from a {@code shared/maps/*.map.txt} file. Outside the map counts as wall. */
public final class TileMap {

	private static final char OUTSIDE_CHAR = '#';

	private final String id;
	private final List<String> rows;
	private final TileType[][] types;
	private final TileType outsideType;
	private final int width;
	private final int height;

	private TileMap(String id, List<String> rows, TileType[][] types, TileType outsideType) {
		this.id = id;
		this.rows = List.copyOf(rows);
		this.types = types;
		this.outsideType = outsideType;
		this.height = rows.size();
		this.width = rows.getFirst().length();
	}

	public static TileMap parse(String id, String source, TileLegend legend) {
		List<String> rows = new ArrayList<>(Arrays.asList(source.replace("\r\n", "\n").split("\n", -1)));
		while (!rows.isEmpty() && rows.getLast().isBlank()) {
			rows.removeLast();
		}
		if (rows.isEmpty()) {
			throw new IllegalArgumentException("Map '" + id + "' is empty");
		}
		int width = rows.getFirst().length();
		TileType[][] types = new TileType[rows.size()][width];
		for (int y = 0; y < rows.size(); y++) {
			String row = rows.get(y);
			if (row.length() != width) {
				throw new IllegalArgumentException("Map '%s' row %d has width %d, expected %d"
						.formatted(id, y + 1, row.length(), width));
			}
			for (int x = 0; x < width; x++) {
				char mapChar = row.charAt(x);
				int column = x + 1;
				int line = y + 1;
				types[y][x] = legend.typeOf(mapChar)
						.orElseThrow(() -> new IllegalArgumentException("Map '%s' has unknown character '%s' at row %d, column %d"
								.formatted(id, mapChar, line, column)));
			}
		}
		TileType outside = legend.typeOf(OUTSIDE_CHAR)
				.orElseThrow(() -> new IllegalStateException("Tile legend lacks '" + OUTSIDE_CHAR + "'"));
		return new TileMap(id, rows, types, outside);
	}

	public String id() {
		return id;
	}

	/** Raw map lines, as sent to clients. */
	public List<String> rows() {
		return rows;
	}

	public int width() {
		return width;
	}

	public int height() {
		return height;
	}

	public boolean isInside(int x, int y) {
		return x >= 0 && y >= 0 && x < width && y < height;
	}

	public TileType typeAt(int x, int y) {
		return isInside(x, y) ? types[y][x] : outsideType;
	}

	public boolean isSolid(int x, int y) {
		return typeAt(x, y).solid();
	}

	public boolean isOpaque(int x, int y) {
		return typeAt(x, y).opaque();
	}

	public TileKind kindAt(int x, int y) {
		return typeAt(x, y).kind();
	}

	public List<GridPos> findAll(TileKind kind) {
		List<GridPos> positions = new ArrayList<>();
		for (int y = 0; y < height; y++) {
			for (int x = 0; x < width; x++) {
				if (types[y][x].kind() == kind) {
					positions.add(new GridPos(x, y));
				}
			}
		}
		return positions;
	}
}
