import { describe, expect, it } from 'vitest'
import { attractStateAt, LOOP_SECONDS, STRIKE_TIME } from './attractTimeline'

describe('attract timeline', () => {
  it('opens with a survivor repairing and the monster hidden far away', () => {
    const state = attractStateAt(2)
    expect(state.actors[0].pose).toBe('repair')
    expect(state.terror).toBe(0)
  })

  it('the monster closes in, strikes, and the survivor runs injured', () => {
    expect(attractStateAt(STRIKE_TIME - 0.5).terror).toBeGreaterThan(0.5)
    const after = attractStateAt(STRIKE_TIME + 1)
    expect(after.actors[0].health).toBe('injured')
    expect(after.actors[0].pose).toBe('run')
    expect(after.flash).toBe(0)
    expect(attractStateAt(STRIKE_TIME + 0.05).flash).toBeGreaterThan(0.5)
  })

  it('loops seamlessly with a fade', () => {
    expect(attractStateAt(0).fade).toBe(0)
    expect(attractStateAt(LOOP_SECONDS - 0.5).fade).toBe(0)
    expect(attractStateAt(5).fade).toBe(1)
    expect(attractStateAt(LOOP_SECONDS + 2)).toEqual(attractStateAt(2))
  })
})
