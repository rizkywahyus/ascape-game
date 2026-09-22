import sheet from './sprites.txt?raw'

/** Colour slot of a sprite cell, resolved against the entity's colour when drawn. */
export type MaskKey = 'b' | 'd' | 'h' | 'e' | 'w' | 'r' | 'y' | 'k'

export interface SpriteCell {
  /** Offset from the anchor (feet): dx right, dy up is negative. */
  readonly dx: number
  readonly dy: number
  readonly glyph: string
  readonly mask: MaskKey
}

export interface Sprite {
  readonly width: number
  readonly height: number
  readonly cells: readonly SpriteCell[]
}

export type Facing = 1 | -1

/** Characters swapped when a right-facing sprite is mirrored to face left. */
const MIRROR: Readonly<Record<string, string>> = {
  '/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<', '[': ']', ']': '[', '{': '}', '}': '{', '`': "'",
  "'": '`',
}
const MASK_KEYS = new Set<MaskKey>(['b', 'd', 'h', 'e', 'w', 'r', 'y', 'k'])
const SPRITE_PATTERN = /@sprite (\S+) (\d+)\n([\s\S]*?)\n---\n([\s\S]*?)\n@end/g

/**
 * Parses sprites.txt. The anchor is the bottom row's centre column: it lands on the cell the character stands on.
 * Throws on malformed sprites so a broken sheet fails loudly at start-up rather than drawing garbage.
 */
export function parseSpriteSheet(source: string): Map<string, Sprite[]> {
  const sprites = new Map<string, Sprite[]>()
  for (const [, name, frame, artBlock, maskBlock] of source.replace(/\r\n/g, '\n').matchAll(SPRITE_PATTERN)) {
    const art = artBlock.split('\n')
    const mask = maskBlock.split('\n')
    if (art.length !== mask.length) throw new Error(`Sprite ${name}#${frame}: art and mask heights differ`)
    const width = Math.max(...art.map((line) => [...line].length))
    const anchorColumn = Math.floor(width / 2)
    const cells: SpriteCell[] = []
    art.forEach((line, row) => {
      const glyphs = [...line]
      const maskRow = [...mask[row]]
      glyphs.forEach((glyph, column) => {
        if (glyph === ' ') return
        const key = (maskRow[column] ?? 'b') as MaskKey
        if (!MASK_KEYS.has(key)) throw new Error(`Sprite ${name}#${frame}: unknown mask '${key}' at ${row},${column}`)
        cells.push({ dx: column - anchorColumn, dy: row - (art.length - 1), glyph, mask: key })
      })
    })
    const frames = sprites.get(name) ?? []
    frames[Number(frame)] = { width, height: art.length, cells }
    sprites.set(name, frames)
  }
  return sprites
}

/** The same sprite facing left: columns flipped around the anchor and directional glyphs swapped. */
export function mirror(sprite: Sprite): Sprite {
  return {
    ...sprite,
    cells: sprite.cells.map((cell) => ({ ...cell, dx: -cell.dx, glyph: MIRROR[cell.glyph] ?? cell.glyph })),
  }
}

const SHEET = parseSpriteSheet(sheet)
const mirrored = new Map<Sprite, Sprite>()

/** Frame `index` of animation `name` (wrapping), facing the given way. */
export function spriteFrame(name: string, index: number, facing: Facing): Sprite {
  const frames = SHEET.get(name)
  if (!frames || frames.length === 0) throw new Error(`Unknown sprite ${name}`)
  const sprite = frames[((index % frames.length) + frames.length) % frames.length]
  if (facing === 1) return sprite
  let flipped = mirrored.get(sprite)
  if (!flipped) {
    flipped = mirror(sprite)
    mirrored.set(sprite, flipped)
  }
  return flipped
}

export function frameCount(name: string): number {
  return SHEET.get(name)?.length ?? 0
}
