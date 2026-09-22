import type { Facing, Pose } from '../animator'
import type { Health, Role } from '../../net/protocol'

/**
 * The scripted scene behind the menu, so a visitor sees what the game is before playing: two survivors repair a
 * generator in the dark, the monster creeps out of the shadows, strikes, and the chase begins. Pure data and
 * interpolation (no drawing), so it can be tested.
 */

export const LOOP_SECONDS = 18
const FADE_OUT_START = 15.5
const FADE_OUT_END = 17
const FADE_IN_SECONDS = 1
/** The heartbeat starts once the monster is this close (tiles). */
const HEARTBEAT_RANGE = 7

/** Moment of the monster's swing; everything after it is the chase. */
export const STRIKE_TIME = 9.4

interface Keyframe {
  readonly t: number
  readonly x: number
  readonly y: number
  readonly pose: Pose
  readonly facing?: Facing
}

interface Track {
  readonly id: number
  readonly kind: Role
  readonly color: string
  readonly keyframes: readonly Keyframe[]
  /** Label shown over the character before / after the strike. */
  readonly label: readonly [string, string]
}

export interface ActorState {
  readonly id: number
  readonly kind: Role
  readonly color: string
  readonly x: number
  readonly y: number
  readonly pose: Pose
  readonly facing: Facing
  readonly health: Health
  readonly label: string
}

export interface AttractState {
  readonly actors: readonly ActorState[]
  readonly generatorProgress: number
  /** 0..1: how hard the survivor's heartbeat pounds (the monster's closeness). */
  readonly terror: number
  /** 0..1 red flash right after the strike. */
  readonly flash: number
  /** 0..1 overall brightness for the loop's fade in and out. */
  readonly fade: number
}

/** Generator of the manor's central hall; the scene is staged around it (see shared/maps/manor.map.txt). */
export const STAGE = { generator: { x: 25, y: 14 }, focus: { x: 28.5, y: 14 } } as const

const ADA: Track = {
  id: 1,
  kind: 'survivor',
  color: '#5dade2',
  label: ['survivor · repairing a generator', 'injured — run!'],
  keyframes: [
    { t: 0, x: 27, y: 15, pose: 'repair', facing: -1 },
    { t: STRIKE_TIME + 0.2, x: 27, y: 15, pose: 'repair', facing: -1 },
    { t: STRIKE_TIME + 0.3, x: 27, y: 15, pose: 'run', facing: -1 },
    { t: 10.6, x: 27, y: 12, pose: 'run', facing: 1 },
    { t: 12.4, x: 32, y: 11, pose: 'run' },
    { t: 12.8, x: 32, y: 11, pose: 'idle' },
  ],
}

const BRAM: Track = {
  id: 2,
  kind: 'survivor',
  color: '#58d68d',
  label: ['survivor', 'survivor · fleeing'],
  keyframes: [
    { t: 0, x: 33, y: 11, pose: 'walk', facing: -1 },
    { t: 3.4, x: 28, y: 12, pose: 'walk' },
    { t: 4.6, x: 27, y: 13, pose: 'walk' },
    { t: 4.7, x: 27, y: 13, pose: 'repair', facing: -1 },
    { t: STRIKE_TIME + 0.4, x: 27, y: 13, pose: 'repair', facing: -1 },
    { t: STRIKE_TIME + 0.5, x: 27, y: 13, pose: 'run', facing: -1 },
    { t: 11.6, x: 25, y: 17, pose: 'run' },
    { t: 12, x: 25, y: 17, pose: 'idle' },
  ],
}

const MONSTER: Track = {
  id: 3,
  kind: 'monster',
  color: '#c0392b',
  label: ['the monster', 'the monster'],
  keyframes: [
    { t: 0, x: 34, y: 17, pose: 'idle', facing: -1 },
    { t: 3, x: 34, y: 17, pose: 'walk', facing: -1 },
    { t: 9, x: 28.4, y: 15.6, pose: 'walk' },
    { t: STRIKE_TIME - 0.3, x: 28.4, y: 15.6, pose: 'idle', facing: -1 },
    { t: STRIKE_TIME, x: 28.4, y: 15.6, pose: 'attack', facing: -1 },
    { t: STRIKE_TIME + 0.5, x: 28.4, y: 15.6, pose: 'lunge', facing: 1 },
    { t: 13.2, x: 31, y: 12, pose: 'lunge' },
    { t: 13.8, x: 31, y: 12, pose: 'idle' },
  ],
}

const TRACKS = [ADA, BRAM, MONSTER]

export function attractStateAt(seconds: number): AttractState {
  const t = ((seconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS
  const actors = TRACKS.map((track) => actorAt(track, t))
  const survivor = actors[0]
  const monster = actors[2]
  const distance = Math.hypot(survivor.x - monster.x, survivor.y - monster.y)
  const struck = t >= STRIKE_TIME
  return {
    actors,
    generatorProgress: Math.min(0.35 + Math.min(t, STRIKE_TIME) * 0.045, 0.95),
    terror: Math.max(0, 1 - distance / HEARTBEAT_RANGE),
    flash: struck ? Math.max(0, 1 - (t - STRIKE_TIME) / 0.4) : 0,
    fade: t < FADE_IN_SECONDS ? t / FADE_IN_SECONDS
      : t > FADE_OUT_START ? Math.max(0, 1 - (t - FADE_OUT_START) / (FADE_OUT_END - FADE_OUT_START)) : 1,
  }
}

function actorAt(track: Track, t: number): ActorState {
  const frames = track.keyframes
  let index = 0
  while (index < frames.length - 1 && frames[index + 1].t <= t) index++
  const from = frames[index]
  const to = frames[Math.min(index + 1, frames.length - 1)]
  const span = to.t - from.t
  const k = span > 0 ? Math.min(1, Math.max(0, (t - from.t) / span)) : 0
  const x = from.x + (to.x - from.x) * k
  const y = from.y + (to.y - from.y) * k
  const facing: Facing = from.facing ?? (to.x < from.x ? -1 : 1)
  const struck = t >= STRIKE_TIME + 0.1
  const injured = track.id === ADA.id && struck
  return {
    id: track.id,
    kind: track.kind,
    color: track.color,
    x,
    y,
    pose: from.pose,
    facing,
    health: injured ? 'injured' : 'healthy',
    label: track.label[struck ? 1 : 0],
  }
}
