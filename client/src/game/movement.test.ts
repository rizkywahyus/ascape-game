import { describe, expect, it } from 'vitest'
import fixture from '../../../shared/fixtures/movement-cases.json'
import { advance, tryStep, type Axis, type MoveState } from './movement'
import { TileMap } from './tileMap'

const walkable = (map: TileMap) => (x: number, y: number) => !map.isSolid(x, y)

describe('shared movement fixture (parity with server)', () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const map = TileMap.parse(testCase.map.join('\n'))
      let state: MoveState = {
        position: { x: testCase.start.x, y: testCase.start.y },
        progress: testCase.start.progress,
      }
      for (const input of testCase.inputs) {
        for (let i = 0; i < input.repeat; i++) {
          const direction = { dx: input.dx as Axis, dy: input.dy as Axis }
          state = advance(walkable(map), state, direction, input.speed, testCase.tickRate)
        }
      }
      expect(state.position).toEqual({ x: testCase.expected.x, y: testCase.expected.y })
      expect(state.progress).toBeCloseTo(testCase.expected.progress, 9)
    })
  }
})

describe('tryStep', () => {
  const room = TileMap.parse(['#####', '#S..#', '#.#.#', '#...#', '#####'].join('\n'))

  it('moves onto floor and stays against walls', () => {
    expect(tryStep(walkable(room), { x: 1, y: 1 }, { dx: 1, dy: 0 })).toEqual({ x: 2, y: 1 })
    expect(tryStep(walkable(room), { x: 1, y: 1 }, { dx: -1, dy: 0 })).toEqual({ x: 1, y: 1 })
  })

  it('moves diagonally when the target is free', () => {
    expect(tryStep(walkable(room), { x: 2, y: 1 }, { dx: 1, dy: 1 })).toEqual({ x: 3, y: 2 })
  })
})
