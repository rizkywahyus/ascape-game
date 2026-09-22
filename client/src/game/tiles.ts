import tileLegend from '../../../shared/maps/tiles.json'

export type TileKind =
  | 'wall'
  | 'floor'
  | 'survivorSpawn'
  | 'monsterSpawn'
  | 'generator'
  | 'generatorFrame'
  | 'gate'
  | 'locker'

/** One entry of shared/maps/tiles.json: how a map character is drawn and whether it blocks movement. */
export interface TileDefinition {
  readonly kind: TileKind
  readonly solid: boolean
  /** Blocks line of sight. */
  readonly opaque: boolean
  readonly glyph: string
  readonly color: string
}

/** Keyed by the character used in map files (shared/maps/*.map.txt). */
export const TILE_DEFINITIONS: Readonly<Record<string, TileDefinition>> = tileLegend as Record<string, TileDefinition>

/** Colours not tied to a map tile. */
export const Palette = {
  background: '#07070a',
  hud: '#7a7a86',
  hudAccent: '#f0a030',
  hudOk: '#58d68d',
  hudWarn: '#e67e22',
  hudDanger: '#c0392b',
} as const
