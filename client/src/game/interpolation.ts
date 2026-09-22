import type { EntityView } from '../net/protocol'

export interface InterpolatedEntity extends EntityView {
  /** Fractional render position in cells. */
  readonly renderX: number
  readonly renderY: number
}

interface BufferedSnapshot {
  readonly serverTimeMs: number
  readonly entities: ReadonlyMap<number, EntityView>
}

const MAX_BUFFERED = 32
/** Moves longer than this are teleports (respawn, takeover) and are not smoothed. */
const MAX_LERP_DISTANCE = 2
const CLOCK_SMOOTHING = 0.05
const CLOCK_RESET_THRESHOLD_MS = 250

/**
 * Buffers snapshots on the server's timeline and renders remote entities slightly in the past,
 * interpolating between the two snapshots around that moment.
 */
export class SnapshotBuffer {
  /** Local time the newest snapshot arrived, for timers carried in snapshots. */
  lastReceivedAtMs: number | null = null
  private snapshots: BufferedSnapshot[] = []
  /** Estimated serverTime − localTime in ms. */
  private clockOffsetMs: number | null = null
  private readonly tickMs: number
  private readonly delayMs: number

  constructor(tickRate: number, delayMs: number) {
    this.tickMs = 1000 / tickRate
    this.delayMs = delayMs
  }

  get size(): number {
    return this.snapshots.length
  }

  push(tick: number, entities: readonly EntityView[], receivedAtMs: number): void {
    const serverTimeMs = tick * this.tickMs
    this.lastReceivedAtMs = receivedAtMs
    this.updateClock(serverTimeMs - receivedAtMs)
    this.snapshots.push({ serverTimeMs, entities: new Map(entities.map((entity) => [entity.id, entity])) })
    if (this.snapshots.length > MAX_BUFFERED) this.snapshots.shift()
  }

  sample(nowMs: number): InterpolatedEntity[] {
    if (this.snapshots.length === 0 || this.clockOffsetMs === null) return []
    const renderTime = nowMs + this.clockOffsetMs - this.delayMs

    let olderIndex = 0
    while (olderIndex < this.snapshots.length - 1 && this.snapshots[olderIndex + 1].serverTimeMs <= renderTime) {
      olderIndex++
    }
    const older = this.snapshots[olderIndex]
    const newer = this.snapshots[olderIndex + 1]
    // Drop snapshots we will never interpolate from again.
    if (olderIndex > 0) this.snapshots = this.snapshots.slice(olderIndex)
    if (!newer || renderTime <= older.serverTimeMs) return [...older.entities.values()].map(atRest)

    const t = (renderTime - older.serverTimeMs) / (newer.serverTimeMs - older.serverTimeMs)
    return [...newer.entities.values()].map((to) => {
      const from = older.entities.get(to.id)
      if (!from || Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) > MAX_LERP_DISTANCE) return atRest(to)
      return { ...to, renderX: from.x + (to.x - from.x) * t, renderY: from.y + (to.y - from.y) * t }
    })
  }

  private updateClock(sampleOffsetMs: number): void {
    if (this.clockOffsetMs === null || Math.abs(sampleOffsetMs - this.clockOffsetMs) > CLOCK_RESET_THRESHOLD_MS) {
      this.clockOffsetMs = sampleOffsetMs
    } else {
      this.clockOffsetMs += (sampleOffsetMs - this.clockOffsetMs) * CLOCK_SMOOTHING
    }
  }
}

function atRest(entity: EntityView): InterpolatedEntity {
  return { ...entity, renderX: entity.x, renderY: entity.y }
}
