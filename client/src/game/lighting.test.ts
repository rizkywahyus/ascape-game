import { describe, expect, it } from 'vitest'
import { computeLighting } from './lighting'
import { isClear, visibleCells } from './lineOfSight'
import { TileMap } from './tileMap'

const map = TileMap.parse(['#########', '#.......#', '#...#...#', '#.......#', '#########'].join('\n'))

describe('line of sight', () => {
  it('is blocked by opaque cells between the ends', () => {
    expect(isClear(map, { x: 2, y: 2 }, { x: 6, y: 2 })).toBe(false)
    expect(isClear(map, { x: 2, y: 1 }, { x: 6, y: 1 })).toBe(true)
  })

  it('sees walls themselves', () => {
    const visible = visibleCells(map, { x: 2, y: 2 }, 3)
    expect(visible[2 * map.width + 4]).toBe(1) // the pillar
    expect(visible[2 * map.width + 5]).toBe(0) // behind it
  })
})

describe('computeLighting', () => {
  it('is brightest at the light and dark behind walls', () => {
    const brightness = computeLighting(map, { x: 2, y: 2 }, [{ position: { x: 2, y: 2 }, radius: 4 }])
    expect(brightness[2 * map.width + 2]).toBeCloseTo(1, 1)
    expect(brightness[2 * map.width + 5]).toBe(0)
    expect(brightness[1 * map.width + 6]).toBe(0) // out of the light radius
  })
})
