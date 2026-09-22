/** Virtual joystick → the same held keys a keyboard player uses (8 directions, like WASD). */

/** Below this fraction of the stick's reach the character stands still, so a resting thumb doesn't walk. */
export const DEAD_ZONE = 0.3
/** Pushing the stick this far out sprints (survivors), like holding Shift. */
export const SPRINT_ZONE = 0.9

const UP = 'KeyW'
const DOWN = 'KeyS'
const LEFT = 'KeyA'
const RIGHT = 'KeyD'
export const STICK_KEYS = [UP, DOWN, LEFT, RIGHT] as const

/** Keys per 45° sector, counter-clockwise from "right"; screen y grows downwards. */
const SECTOR_KEYS: readonly (readonly string[])[] = [
  [RIGHT],
  [DOWN, RIGHT],
  [DOWN],
  [DOWN, LEFT],
  [LEFT],
  [UP, LEFT],
  [UP],
  [UP, RIGHT],
]

export interface StickState {
  readonly keys: readonly string[]
  readonly sprint: boolean
}

/** `dx`, `dy`: thumb offset from the stick's centre in pixels; `reach`: the stick's radius. */
export function readStick(dx: number, dy: number, reach: number): StickState {
  const distance = Math.hypot(dx, dy) / reach
  if (distance < DEAD_ZONE) return { keys: [], sprint: false }
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  return { keys: SECTOR_KEYS[((sector % 8) + 8) % 8], sprint: distance >= SPRINT_ZONE }
}
