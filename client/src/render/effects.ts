import type { ClientGame } from '../game/clientGame'
import type { EventPayload } from '../net/protocol'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  bornMs: number
  lifeMs: number
  glyph: string
  color: string
}

const FLASH_MS = 350
const SHAKE_MS = 300
const SONAR_MS = 1_500
const PARTICLE_GLYPHS = ['*', '+', '·', '\'']
const SPARK_COLORS = ['#ffd24a', '#fff2a8', '#f0a030']
const SPARKLE_CHANCE_PER_FRAME = 0.02
const SPARKLE_SPEED = 2
const BURST_SPEED = 6

/** Short-lived visual feedback driven by match events: flash, shake, sparks, sonar ring. */
export class Effects {
  flashUntilMs = 0
  flashColor = '#c0392b'
  shakeUntilMs = 0
  sonarStartMs = -Infinity
  sonarOrigin: { x: number; y: number } | null = null
  particles: Particle[] = []

  attach(game: ClientGame): void {
    game.onGameEvent((event, current) => this.onEvent(event, current))
  }

  private onEvent(event: EventPayload, game: ClientGame): void {
    const now = performance.now()
    const selfId = game.latest?.you.id
    const involvesMe = event.data.victimId === selfId
    switch (event.kind) {
      case 'hit':
      case 'downed':
        if (involvesMe) {
          this.flash('#c0392b', now)
          this.shakeUntilMs = now + SHAKE_MS
        } else if (event.data.attackerId === selfId) {
          this.shakeUntilMs = now + SHAKE_MS / 2
        }
        break
      case 'trap':
        if (involvesMe) this.shakeUntilMs = now + SHAKE_MS
        break
      case 'generator_done':
        this.burst(Number(event.data.x), Number(event.data.y), now)
        break
      case 'gate_open':
        this.flash('#ffffff', now)
        break
      case 'sonar': {
        const monster = game.latest?.entities.find((entity) => entity.kind === 'monster')
        this.sonarStartMs = now
        this.sonarOrigin = monster ? { x: monster.x, y: monster.y } : null
        if (game.role() !== 'monster') this.flash('#5b1a14', now)
        break
      }
      case 'skill_check':
        if (event.data.survivorId === selfId && !event.data.success) this.shakeUntilMs = now + SHAKE_MS / 2
        break
      default:
        break
    }
  }

  /** Occasional sparks from generators being repaired (called every frame, so the chance is small). */
  sparkle(x: number, y: number, now: number): void {
    if (Math.random() < SPARKLE_CHANCE_PER_FRAME) this.spawn(x, y, now, 1, SPARKLE_SPEED)
  }

  flashAlpha(now: number): number {
    return now < this.flashUntilMs ? ((this.flashUntilMs - now) / FLASH_MS) * 0.35 : 0
  }

  /** Whole-cell camera offset while shaking. */
  shakeOffset(now: number): { dx: number; dy: number } {
    if (now >= this.shakeUntilMs) return { dx: 0, dy: 0 }
    return { dx: Math.round(Math.random() * 2 - 1), dy: Math.round(Math.random() * 2 - 1) }
  }

  /** Radius of the expanding sonar ring in cells, or null when none is active. */
  sonarRadius(now: number, maxRadius: number): number | null {
    const elapsed = now - this.sonarStartMs
    return elapsed >= 0 && elapsed < SONAR_MS ? (elapsed / SONAR_MS) * maxRadius : null
  }

  update(now: number): void {
    this.particles = this.particles.filter((p) => now - p.bornMs < p.lifeMs)
  }

  particlePosition(particle: Particle, now: number): { x: number; y: number; life: number } {
    const age = (now - particle.bornMs) / 1000
    return {
      x: particle.x + particle.vx * age,
      y: particle.y + particle.vy * age + 2 * age * age,
      life: 1 - (now - particle.bornMs) / particle.lifeMs,
    }
  }

  private flash(color: string, now: number): void {
    this.flashColor = color
    this.flashUntilMs = now + FLASH_MS
  }

  private burst(x: number, y: number, now: number): void {
    this.spawn(x, y, now, 18, BURST_SPEED)
  }

  private spawn(x: number, y: number, now: number, count: number, maxSpeed: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 1 + Math.random() * maxSpeed
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        bornMs: now,
        lifeMs: 500 + Math.random() * 600,
        glyph: PARTICLE_GLYPHS[i % PARTICLE_GLYPHS.length],
        color: SPARK_COLORS[i % SPARK_COLORS.length],
      })
    }
  }
}
