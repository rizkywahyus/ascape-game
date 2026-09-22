import { visibleCells } from './lineOfSight'
import type { GridPosition, TileMap } from './tileMap'

export interface LightSource {
  readonly position: GridPosition
  readonly radius: number
}

/** Brightness below which a lit cell still reads as "lit" (so the edge of the light is not black). */
const MIN_LIT = 0.3
/** How far the viewer can see lit cells (a lit room across a hall). Matches the monster's longest sight. */
const SIGHT_RADIUS = 16

/**
 * Per-cell brightness (0..1) for the local view: a cell is lit if some light reaches it with line of sight
 * *and* the viewer can see it. Pure presentation: which entities are visible is decided by the server.
 */
export function computeLighting(map: TileMap, viewer: GridPosition, lights: readonly LightSource[]): Float32Array {
  const brightness = new Float32Array(map.width * map.height)
  const inSight = visibleCells(map, viewer, SIGHT_RADIUS)
  for (const light of lights) {
    const lit = visibleCells(map, light.position, light.radius)
    const radiusSquared = light.radius * light.radius
    for (let y = light.position.y - light.radius; y <= light.position.y + light.radius; y++) {
      for (let x = light.position.x - light.radius; x <= light.position.x + light.radius; x++) {
        if (!map.isInside(x, y)) continue
        const index = y * map.width + x
        if (!lit[index] || !inSight[index]) continue
        const dx = x - light.position.x
        const dy = y - light.position.y
        const falloff = 1 - (dx * dx + dy * dy) / (radiusSquared + 1)
        brightness[index] = Math.max(brightness[index], MIN_LIT + (1 - MIN_LIT) * falloff)
      }
    }
  }
  return brightness
}
