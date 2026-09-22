import { describe, expect, it } from 'vitest'
import manorMapSource from '../../../shared/maps/manor.map.txt?raw'
import { TileMap } from './tileMap'

describe('TileMap.parse', () => {
  it('parses dimensions and ignores trailing blank lines', () => {
    const map = TileMap.parse('####\n#S.#\n####\n\n')
    expect(map.width).toBe(4)
    expect(map.height).toBe(3)
    expect(map.findAll('survivorSpawn')).toEqual([{ x: 1, y: 1 }])
  })

  it('accepts CRLF line endings', () => {
    expect(TileMap.parse('###\r\n#S#\r\n###').height).toBe(3)
  })

  it('rejects ragged rows', () => {
    expect(() => TileMap.parse('####\n#S#\n####')).toThrow(/row 2 has width 3, expected 4/)
  })

  it('rejects unknown characters', () => {
    expect(() => TileMap.parse('###\n#x#\n###')).toThrow(/Unknown map character 'x' at row 2, column 2/)
  })

  it('rejects an empty map', () => {
    expect(() => TileMap.parse('\n\n')).toThrow(/empty/)
  })

  it('treats outside the map as solid wall', () => {
    const map = TileMap.parse('#S#')
    expect(map.isSolid(-1, 0)).toBe(true)
    expect(map.isSolid(0, 5)).toBe(true)
    expect(map.isSolid(1, 0)).toBe(false)
  })
})

describe('shared/maps/manor.map.txt', () => {
  const map = TileMap.parse(manorMapSource)

  it('has the objectives the game design needs', () => {
    expect(map.findAll('generator')).toHaveLength(7)
    expect(map.findAll('survivorSpawn')).toHaveLength(4)
    expect(map.findAll('monsterSpawn')).toHaveLength(1)
    expect(map.findAll('gate').length).toBeGreaterThan(0)
  })

  it('is closed: every border cell is solid', () => {
    for (let x = 0; x < map.width; x++) {
      expect(map.isSolid(x, 0)).toBe(true)
      expect(map.isSolid(x, map.height - 1)).toBe(true)
    }
    for (let y = 0; y < map.height; y++) {
      expect(map.isSolid(0, y)).toBe(true)
      expect(map.isSolid(map.width - 1, y)).toBe(true)
    }
  })

  it('connects every walkable cell to the survivor spawn', () => {
    const [start] = map.findAll('survivorSpawn')
    const seen = new Set([`${start.x},${start.y}`])
    const queue = [start]
    while (queue.length > 0) {
      const { x, y } = queue.pop()!
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${x + dx},${y + dy}`
        if (!map.isSolid(x + dx, y + dy) && !seen.has(key)) {
          seen.add(key)
          queue.push({ x: x + dx, y: y + dy })
        }
      }
    }
    const walkable = [...Array(map.height).keys()].flatMap((y) =>
      [...Array(map.width).keys()].filter((x) => !map.isSolid(x, y)),
    ).length
    expect(seen.size).toBe(walkable)
  })
})
