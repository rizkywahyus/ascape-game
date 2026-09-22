import { describe, expect, it } from 'vitest'
import { frameCount, mirror, parseSpriteSheet, spriteFrame } from './sprites'

describe('sprite sheet', () => {
  it('parses art, mask and a feet anchor', () => {
    const sheet = parseSpriteSheet('@sprite guy 0\n o\n/|\\\n---\n h\nbbb\n@end')
    const sprite = sheet.get('guy')![0]
    expect(sprite.width).toBe(3)
    expect(sprite.height).toBe(2)
    expect(sprite.cells).toContainEqual({ dx: 0, dy: -1, glyph: 'o', mask: 'h' })
    expect(sprite.cells).toContainEqual({ dx: -1, dy: 0, glyph: '/', mask: 'b' })
  })

  it('rejects mismatched masks', () => {
    expect(() => parseSpriteSheet('@sprite bad 0\n o\n---\n h\nb\n@end')).toThrow(/heights differ/)
  })

  it('mirrors columns and directional glyphs', () => {
    const sprite = parseSpriteSheet('@sprite arm 0\n o/\n---\n hb\n@end').get('arm')![0]
    const flipped = mirror(sprite)
    expect(flipped.cells).toContainEqual({ dx: -1, dy: 0, glyph: '\\', mask: 'b' })
  })

  it('ships every animation the renderer asks for', () => {
    for (const name of ['survivor.idle', 'survivor.walk', 'survivor.run', 'survivor.repair', 'survivor.downed',
      'monster.idle', 'monster.walk', 'monster.attack', 'monster.lunge', 'monster.catch']) {
      expect(frameCount(name), name).toBeGreaterThan(0)
      expect(spriteFrame(name, 5, -1).cells.length, name).toBeGreaterThan(0)
    }
  })
})
