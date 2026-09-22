import type { GridPosition, TileMap } from './tileMap'

/**
 * Field of view, mirrored from the server's LineOfSight.java: a cell is visible if it lies within a circular
 * radius and the Bresenham line to it crosses no opaque cell (the target itself may be opaque).
 * Returns a bitmap indexed by `y * map.width + x`.
 */
export function visibleCells(map: TileMap, origin: GridPosition, radius: number): Uint8Array {
  const visible = new Uint8Array(map.width * map.height)
  const radiusSquared = radius * radius
  for (let y = Math.max(0, origin.y - radius); y <= Math.min(map.height - 1, origin.y + radius); y++) {
    for (let x = Math.max(0, origin.x - radius); x <= Math.min(map.width - 1, origin.x + radius); x++) {
      const dx = x - origin.x
      const dy = y - origin.y
      if (dx * dx + dy * dy <= radiusSquared && isClear(map, origin, { x, y })) visible[y * map.width + x] = 1
    }
  }
  return visible
}

export function isClear(map: TileMap, from: GridPosition, to: GridPosition): boolean {
  let x = from.x
  let y = from.y
  const dx = Math.abs(to.x - x)
  const dy = -Math.abs(to.y - y)
  const stepX = x < to.x ? 1 : -1
  const stepY = y < to.y ? 1 : -1
  let error = dx + dy
  while (x !== to.x || y !== to.y) {
    const doubled = 2 * error
    if (doubled >= dy) {
      error += dy
      x += stepX
    }
    if (doubled <= dx) {
      error += dx
      y += stepY
    }
    if ((x !== to.x || y !== to.y) && map.isOpaque(x, y)) return false
  }
  return true
}
