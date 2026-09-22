import type { GridPosition } from './tileMap'

/**
 * Grid movement mirrored from the server's Movement.java. Both must stay identical: the client predicts
 * its own character with it. shared/fixtures/movement-cases.json is run against both implementations.
 */

export type Axis = -1 | 0 | 1

export interface Direction {
  readonly dx: Axis
  readonly dy: Axis
}

/** Position plus accumulated move progress; one step costs 1. */
export interface MoveState {
  readonly position: GridPosition
  readonly progress: number
}

export type IsWalkable = (x: number, y: number) => boolean

const STEP_COST = 1

/** Advances one tick. At most one step per tick: speeds are far below the tick rate. */
export function advance(
  isWalkable: IsWalkable,
  state: MoveState,
  direction: Direction,
  speed: number,
  tickRate: number,
): MoveState {
  const progress = state.progress + speed / tickRate
  const moving = direction.dx !== 0 || direction.dy !== 0
  if (!moving || progress < STEP_COST) {
    return { position: state.position, progress: Math.min(progress, STEP_COST) }
  }
  const next = tryStep(isWalkable, state.position, direction)
  if (next.x === state.position.x && next.y === state.position.y) {
    return { position: next, progress: Math.min(progress, STEP_COST) }
  }
  return { position: next, progress: progress - STEP_COST }
}

/**
 * One cell towards `direction` if walkable. A blocked diagonal slides along whichever axis is free;
 * a diagonal never cuts between two solid orthogonal neighbours.
 */
export function tryStep(isWalkable: IsWalkable, from: GridPosition, direction: Direction): GridPosition {
  const { dx, dy } = direction
  if (dx === 0 && dy === 0) return from

  const horizontalFree = dx !== 0 && isWalkable(from.x + dx, from.y)
  const verticalFree = dy !== 0 && isWalkable(from.x, from.y + dy)

  if (dx !== 0 && dy !== 0 && (horizontalFree || verticalFree) && isWalkable(from.x + dx, from.y + dy)) {
    return { x: from.x + dx, y: from.y + dy }
  }
  if (horizontalFree) return { x: from.x + dx, y: from.y }
  if (verticalFree) return { x: from.x, y: from.y + dy }
  return from
}
