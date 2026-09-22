import { describe, expect, it } from 'vitest'
import type { EntityView } from '../net/protocol'
import { SnapshotBuffer } from './interpolation'

const TICK_RATE = 20
const TICK_MS = 1000 / TICK_RATE
const entity = (x: number, y: number): EntityView => ({
  id: 7,
  kind: 'survivor',
  x,
  y,
  glyph: '@',
  color: '#fff',
  name: 'a',
  health: 'healthy',
  flashlight: true,
  activity: 'none',
})

describe('SnapshotBuffer', () => {
  it('interpolates between the two snapshots around the delayed render time', () => {
    const buffer = new SnapshotBuffer(TICK_RATE, 2 * TICK_MS)
    buffer.push(10, [entity(0, 0)], 1000)
    buffer.push(11, [entity(1, 0)], 1000 + TICK_MS)
    buffer.push(12, [entity(2, 0)], 1000 + 2 * TICK_MS)

    // Server time = tick × 50 ms, received 500 ms later on our clock, so offset = −500 ms.
    // renderTime = now − 500 − 100 (delay) = 525 ms: halfway between tick 10 (500 ms) and tick 11 (550 ms).
    const [sampled] = buffer.sample(1125)
    expect(sampled.renderX).toBeCloseTo(0.5, 5)
  })

  it('does not smooth teleports', () => {
    const buffer = new SnapshotBuffer(TICK_RATE, TICK_MS)
    buffer.push(1, [entity(0, 0)], 0)
    buffer.push(2, [entity(10, 0)], TICK_MS)
    const [sampled] = buffer.sample(TICK_MS + TICK_MS / 2)
    expect(sampled.renderX).toBe(10)
  })

  it('holds the latest state when render time passes the newest snapshot', () => {
    const buffer = new SnapshotBuffer(TICK_RATE, 0)
    buffer.push(1, [entity(3, 4)], 0)
    const [sampled] = buffer.sample(500)
    expect([sampled.renderX, sampled.renderY]).toEqual([3, 4])
  })
})
