import type { Activity, Health, Role } from '../net/protocol'

export type Facing = 1 | -1

/** What an entity looks like it is doing, derived from how it moves (the server does not send poses). */
export type Pose = 'idle' | 'walk' | 'run' | 'repair' | 'downed' | 'attack' | 'lunge' | 'catch'

export interface AnimationFrame {
  readonly pose: Pose
  /** Continuous cycle position in radians (one full stride per 2π), for smooth limb swings. */
  readonly phase: number
  readonly facing: Facing
}

export interface Animatable {
  readonly id: number
  readonly kind: Role
  readonly x: number
  readonly y: number
  readonly health: Health
  readonly activity: Activity
}

interface Motion {
  x: number
  y: number
  facing: Facing
  lastStepMs: number
  /** Smoothed time between steps; short intervals mean running. */
  stepIntervalMs: number
  attackUntilMs: number
}

/** A step counts as "still moving" for this long, so walk cycles do not flicker between steps. */
const MOVING_GRACE_MS = 260
const RUN_INTERVAL_MS = 150
const LUNGE_INTERVAL_MS = 125
const ATTACK_POSE_MS = 280
/** Duration of one full animation cycle per pose. */
const CYCLE_MS: Record<Pose, number> = {
  idle: 2_200, walk: 400, run: 260, repair: 700, downed: 3_000, attack: 1_000, lunge: 280, catch: 900,
}
const INTERVAL_SMOOTHING = 0.5

/** Tracks per-entity motion between snapshots and picks the sprite animation and frame to draw. */
export class Animator {
  private readonly motion = new Map<number, Motion>()

  /** Called when an attack is seen (own swing or a `hit` event), to show the swipe pose. */
  markAttack(entityId: number, nowMs: number): void {
    const motion = this.motion.get(entityId)
    if (motion) motion.attackUntilMs = nowMs + ATTACK_POSE_MS
  }

  forget(activeIds: ReadonlySet<number>): void {
    for (const id of this.motion.keys()) if (!activeIds.has(id)) this.motion.delete(id)
  }

  frame(entity: Animatable, nowMs: number): AnimationFrame {
    const motion = this.track(entity, nowMs)
    const pose = this.pose(entity, motion, nowMs)
    const phase = (((nowMs + entity.id * 137) / CYCLE_MS[pose]) % 1) * Math.PI * 2
    return { pose, phase, facing: motion.facing }
  }

  private track(entity: Animatable, nowMs: number): Motion {
    let motion = this.motion.get(entity.id)
    if (!motion) {
      motion = { x: entity.x, y: entity.y, facing: 1, lastStepMs: -Infinity, stepIntervalMs: 1_000, attackUntilMs: 0 }
      this.motion.set(entity.id, motion)
      return motion
    }
    if (entity.x !== motion.x || entity.y !== motion.y) {
      if (entity.x !== motion.x) motion.facing = entity.x > motion.x ? 1 : -1
      const interval = nowMs - motion.lastStepMs
      if (Number.isFinite(interval)) {
        motion.stepIntervalMs += (Math.min(interval, 1_000) - motion.stepIntervalMs) * INTERVAL_SMOOTHING
      }
      motion.lastStepMs = nowMs
      motion.x = entity.x
      motion.y = entity.y
    }
    return motion
  }

  private pose(entity: Animatable, motion: Motion, nowMs: number): Pose {
    const moving = nowMs - motion.lastStepMs < MOVING_GRACE_MS
    if (entity.kind === 'survivor') {
      if (entity.health === 'downed') return 'downed'
      if (entity.activity !== 'none') return 'repair'
      if (!moving) return 'idle'
      return motion.stepIntervalMs < RUN_INTERVAL_MS ? 'run' : 'walk'
    }
    if (nowMs < motion.attackUntilMs) return 'attack'
    if (entity.activity === 'catch') return 'catch'
    if (!moving) return 'idle'
    return motion.stepIntervalMs < LUNGE_INTERVAL_MS ? 'lunge' : 'walk'
  }
}
