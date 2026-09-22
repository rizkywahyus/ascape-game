import { describe, expect, it } from 'vitest'
import { Animator, type Animatable } from './animator'

const survivor = (x: number, overrides: Partial<Animatable> = {}): Animatable => ({
  id: 1, kind: 'survivor', x, y: 5, health: 'healthy', activity: 'none', ...overrides,
})

describe('Animator', () => {
  it('idles when standing still', () => {
    const animator = new Animator()
    expect(animator.frame(survivor(3), 0).pose).toBe('idle')
  })

  it('walks, runs and faces the way it moves', () => {
    const animator = new Animator()
    animator.frame(survivor(10), 0)
    let now = 0
    for (let x = 9; x >= 5; x--) {
      now += 180 // walking pace
      animator.frame(survivor(x), now)
    }
    const walking = animator.frame(survivor(5), now + 10)
    expect(walking.pose).toBe('walk')
    expect(walking.facing).toBe(-1)

    for (let x = 6; x <= 12; x++) {
      now += 110 // sprinting pace
      animator.frame(survivor(x), now)
    }
    const running = animator.frame(survivor(12), now + 10)
    expect(running.pose).toBe('run')
    expect(running.facing).toBe(1)
  })

  it('shows states over motion', () => {
    const animator = new Animator()
    expect(animator.frame(survivor(1, { health: 'downed' }), 0).pose).toBe('downed')
    expect(animator.frame(survivor(1, { activity: 'repair' }), 0).pose).toBe('repair')
    const monster: Animatable = { id: 2, kind: 'monster', x: 1, y: 1, health: 'healthy', activity: 'none' }
    animator.frame(monster, 0)
    animator.markAttack(2, 0)
    expect(animator.frame(monster, 100).pose).toBe('attack')
    expect(animator.frame(monster, 1_000).pose).toBe('idle')
  })
})
