import type { TileMap } from '../game/tileMap'
import type { GeneratorView } from '../net/protocol'

/** Every map tile is drawn as a block of TILE_W × TILE_H character cells (≈ square with 1:2 glyphs). */
export const TILE_W = 5
export const TILE_H = 3

export interface CellArt {
  /** null: nothing drawn (the cell only shows the light). */
  readonly glyph: string | null
  readonly color: string
  /** Dense glyphs (walls, blocks) get a lower light gain than thin ones, or they glare under a flashlight. */
  readonly solid: boolean
}

export interface TileArtState {
  /** Generators keyed by `y * map.width + x` of their `G` cell. */
  readonly generators: ReadonlyMap<number, GeneratorView>
  readonly gateOpen: boolean
  readonly nowMs: number
}

const WALL = '#4a4a57'
const WALL_FACE = '#22222a'
const WALL_CRACK = '#3a3a45'
/** Solid map interior with no floor next to it is drawn as empty void, so rooms read clearly. */
export const VOID: CellArt = { glyph: null, color: '#000000', solid: false }
const edgeWallCache = new WeakMap<TileMap, Uint8Array>()
const DUST = '#34343e'
const DUST_GLYPHS = ['.', '·', ',', '`', "'"]
const DUST_DENSITY = 0.1
const CRACK_DENSITY = 0.12
const FRAME_COLOR = '#6a5a30'
const LAMP_IDLE = '#e0b030'
const DONE_COLOR = '#58d68d'
const GAUGE_EMPTY = '#3d3520'
const LOCKER_COLOR = '#8b5a2b'
const GATE_COLOR = '#8a8a94'
const GATE_OPEN_COLOR = '#ffffff'
const GATE_BLINK_MS = 400
const EMPTY: CellArt = { glyph: null, color: DUST, solid: false }

/** 3 tiles wide ([, G, ]) × 1 tile tall. Gauge cells (▒) fill with progress. */
const GENERATOR_ART = ['╔═════════════╗', '║ ◘ ▕▒▒▒▒▒▒▏◘ ║', '╚═╤═════════╤═╝']
const GAUGE_ROW = 1
const GAUGE_START = 5
const GAUGE_CELLS = 6
const LAMP_COLUMNS = new Set([2, 12])
const LOCKER_ART = ['┌───┐', '│┅┅┅│', '└─o─┘']

/** Glyph and base colour for sub-cell (cx, cy) of tile (x, y). Lighting is applied by the renderer. */
export function tileCellArt(map: TileMap, x: number, y: number, cx: number, cy: number, state: TileArtState): CellArt {
  const tile = map.tileAt(x, y)
  switch (tile.kind) {
    case 'wall':
      return wallCell(map, x, y, cx, cy)
    case 'generator':
    case 'generatorFrame':
      return generatorCell(map, x, y, cx, cy, state)
    case 'locker':
      return { glyph: LOCKER_ART[cy][cx], color: LOCKER_COLOR, solid: false }
    case 'gate':
      return gateCell(cx, state)
    default:
      return floorCell(x, y, cx, cy)
  }
}

function wallCell(map: TileMap, x: number, y: number, cx: number, cy: number): CellArt {
  if (!isEdgeWall(map, x, y)) return VOID
  // The row facing the room below is the wall's front face: a dark ledge, which reads as depth.
  const faceBelow = cy === TILE_H - 1 && map.isInside(x, y + 1) && map.tileAt(x, y + 1).kind !== 'wall'
  if (faceBelow) return { glyph: '█', color: WALL_FACE, solid: true }
  const cracked = hash(x * TILE_W + cx, y * TILE_H + cy) < CRACK_DENSITY
  return cracked ? { glyph: '▒', color: WALL_CRACK, solid: true } : { glyph: '▓', color: WALL, solid: true }
}

/** A wall tile with at least one non-wall neighbour (8 directions); computed once per map. */
function isEdgeWall(map: TileMap, x: number, y: number): boolean {
  let edges = edgeWallCache.get(map)
  if (!edges) {
    edges = new Uint8Array(map.width * map.height)
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        let edge = false
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1 && !edge; dx++) {
            edge = map.isInside(tx + dx, ty + dy) && map.tileAt(tx + dx, ty + dy).kind !== 'wall'
          }
        }
        edges[ty * map.width + tx] = edge ? 1 : 0
      }
    }
    edgeWallCache.set(map, edges)
  }
  return edges[y * map.width + x] === 1
}

function floorCell(x: number, y: number, cx: number, cy: number): CellArt {
  const noise = hash(x * TILE_W + cx + 7, y * TILE_H + cy + 3)
  if (noise >= DUST_DENSITY) return EMPTY
  return { glyph: DUST_GLYPHS[Math.floor((noise / DUST_DENSITY) * DUST_GLYPHS.length)], color: DUST, solid: false }
}

function generatorCell(map: TileMap, x: number, y: number, cx: number, cy: number, state: TileArtState): CellArt {
  // Find the generator's G cell: the frame tiles sit left and right of it.
  const offset = map.tileAt(x, y).kind === 'generator' ? 0 : map.charAt(x, y) === '[' ? 1 : -1
  const generator = state.generators.get(y * map.width + x + offset)
  const column = (1 - offset) * TILE_W + cx
  const glyph = GENERATOR_ART[cy][column]
  const done = generator?.done ?? false
  if (cy === GAUGE_ROW && column >= GAUGE_START && column < GAUGE_START + GAUGE_CELLS) {
    const filled = done ? GAUGE_CELLS : Math.round((generator?.progress ?? 0) * GAUGE_CELLS)
    const lit = column - GAUGE_START < filled
    return { glyph: lit ? '█' : '▒', color: lit ? DONE_COLOR : GAUGE_EMPTY, solid: false }
  }
  if (cy === GAUGE_ROW && LAMP_COLUMNS.has(column)) {
    return { glyph: done ? '◉' : '◘', color: done ? DONE_COLOR : LAMP_IDLE, solid: false }
  }
  return { glyph: glyph === ' ' ? null : glyph, color: done ? DONE_COLOR : FRAME_COLOR, solid: false }
}

function gateCell(cx: number, state: TileArtState): CellArt {
  if (!state.gateOpen) return { glyph: cx % 2 === 0 ? '║' : '╫', color: GATE_COLOR, solid: false }
  const blink = Math.floor(state.nowMs / GATE_BLINK_MS) % 2 === 0
  return { glyph: (cx + (blink ? 0 : 1)) % 2 === 0 ? '░' : ' ', color: GATE_OPEN_COLOR, solid: false }
}

/** Stable pseudo-random value in [0, 1) per cell, so textures do not flicker. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
