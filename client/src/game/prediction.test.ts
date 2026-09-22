import { describe, expect, it } from 'vitest'
import { advance, type Direction } from './movement'
import { PredictedCharacter } from './prediction'
import { TileMap } from './tileMap'

const TICK_RATE = 20
const SPEED = 5
const RIGHT: Direction = { dx: 1, dy: 0 }
const corridor = TileMap.parse('############\n#S.........#\n############')
const walkable = (x: number, y: number) => !corridor.isSolid(x, y)

describe('PredictedCharacter', () => {
  it('applies inputs locally before the server answers', () => {
    const character = new PredictedCharacter({ position: { x: 1, y: 1 }, progress: 1 }, TICK_RATE)
    character.applyLocal(1, RIGHT, SPEED, walkable)
    expect(character.state.position).toEqual({ x: 2, y: 1 })
    expect(character.pendingCount).toBe(1)
  })

  it('replays unacknowledged inputs on top of the server state without a correction', () => {
    const character = new PredictedCharacter({ position: { x: 1, y: 1 }, progress: 1 }, TICK_RATE)
    let server = { position: { x: 1, y: 1 }, progress: 1 }
    for (let seq = 1; seq <= 8; seq++) character.applyLocal(seq, RIGHT, SPEED, walkable)
    // Server has processed the first 3 inputs identically.
    for (let seq = 1; seq <= 3; seq++) server = advance(walkable, server, RIGHT, SPEED, TICK_RATE)
    const predictedBefore = character.state

    character.reconcile({ x: server.position.x, y: server.position.y, moveProgress: server.progress }, 3, walkable)

    expect(character.state).toEqual(predictedBefore)
    expect(character.pendingCount).toBe(5)
    expect(character.corrections).toBe(0)
  })

  it('snaps to the server when prediction was wrong', () => {
    const character = new PredictedCharacter({ position: { x: 1, y: 1 }, progress: 1 }, TICK_RATE)
    character.applyLocal(1, RIGHT, SPEED, walkable)

    // Server says we never moved (e.g. the input was trimmed).
    character.reconcile({ x: 1, y: 1, moveProgress: 0 }, 1, walkable)

    expect(character.state.position).toEqual({ x: 1, y: 1 })
    expect(character.corrections).toBe(1)
  })
})
