/**
 * First visible map coordinate on one axis.
 * A map smaller than the view is centred (the origin goes negative);
 * a larger map follows `focus` but never scrolls past its edges.
 */
export function viewportOrigin(focus: number, mapSize: number, viewSize: number): number {
  if (mapSize <= viewSize) return -Math.floor((viewSize - mapSize) / 2)
  const centred = focus - Math.floor(viewSize / 2)
  return Math.min(Math.max(centred, 0), mapSize - viewSize)
}
