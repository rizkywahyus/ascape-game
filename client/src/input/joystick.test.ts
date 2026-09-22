import { describe, expect, it } from 'vitest'
import { DEAD_ZONE, readStick, SPRINT_ZONE } from './joystick'

const REACH = 60

describe('readStick', () => {
  it('ignores a thumb resting inside the dead zone', () => {
    expect(readStick(REACH * DEAD_ZONE * 0.9, 0, REACH).keys).toEqual([])
  })

  it('maps the four axes to WASD (screen y grows downwards)', () => {
    expect(readStick(40, 0, REACH).keys).toEqual(['KeyD'])
    expect(readStick(-40, 0, REACH).keys).toEqual(['KeyA'])
    expect(readStick(0, -40, REACH).keys).toEqual(['KeyW'])
    expect(readStick(0, 40, REACH).keys).toEqual(['KeyS'])
  })

  it('maps diagonals to two keys', () => {
    expect(readStick(30, -30, REACH).keys).toEqual(['KeyW', 'KeyD'])
    expect(readStick(-30, 30, REACH).keys).toEqual(['KeyS', 'KeyA'])
  })

  it('snaps to the nearest of 8 directions', () => {
    // 20° below the horizontal is still "right", 25° is already the diagonal.
    const at = (degrees: number) => readStick(Math.cos((degrees * Math.PI) / 180) * 40, Math.sin((degrees * Math.PI) / 180) * 40, REACH)
    expect(at(20).keys).toEqual(['KeyD'])
    expect(at(25).keys).toEqual(['KeyS', 'KeyD'])
    expect(at(180).keys).toEqual(['KeyA'])
    expect(at(-179).keys).toEqual(['KeyA'])
  })

  it('sprints only when pushed to the edge', () => {
    expect(readStick(REACH * 0.6, 0, REACH).sprint).toBe(false)
    expect(readStick(REACH * SPRINT_ZONE, 0, REACH).sprint).toBe(true)
  })
})
