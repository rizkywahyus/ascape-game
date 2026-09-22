import { TILE_DEFINITIONS, type TileDefinition, type TileKind } from './tiles'

export interface GridPosition {
  readonly x: number
  readonly y: number
}

export class TileMap {
  readonly width: number
  readonly height: number
  private readonly rows: readonly string[]

  private constructor(rows: readonly string[]) {
    this.rows = rows
    this.height = rows.length
    this.width = rows[0].length
  }

  /**
   * Parses a map file (`shared/maps/*.map.txt`): one row per line, every row the same width,
   * every character a key of TILE_DEFINITIONS. Trailing blank lines are ignored.
   */
  static parse(source: string): TileMap {
    const rows = source.replace(/\r\n/g, '\n').split('\n')
    while (rows.length > 0 && rows[rows.length - 1].trim() === '') rows.pop()
    if (rows.length === 0) throw new Error('Map is empty')

    const width = [...rows[0]].length
    rows.forEach((row, y) => {
      const chars = [...row]
      if (chars.length !== width) {
        throw new Error(`Map row ${y + 1} has width ${chars.length}, expected ${width}`)
      }
      chars.forEach((char, x) => {
        if (!(char in TILE_DEFINITIONS)) {
          throw new Error(`Unknown map character '${char}' at row ${y + 1}, column ${x + 1}`)
        }
      })
    })
    return new TileMap(rows)
  }

  isInside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /** Map character at (x, y); outside the map counts as wall. */
  charAt(x: number, y: number): string {
    return this.isInside(x, y) ? this.rows[y][x] : '#'
  }

  tileAt(x: number, y: number): TileDefinition {
    return TILE_DEFINITIONS[this.charAt(x, y)]
  }

  isSolid(x: number, y: number): boolean {
    return this.tileAt(x, y).solid
  }

  isOpaque(x: number, y: number): boolean {
    return this.tileAt(x, y).opaque
  }

  findAll(kind: TileKind): GridPosition[] {
    const positions: GridPosition[] = []
    this.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (TILE_DEFINITIONS[row[x]].kind === kind) positions.push({ x, y })
      }
    })
    return positions
  }
}
