/** Rolling client-side timing stats for the F3 overlay: frame pacing and gaps between server snapshots. */
export class PerfStats {
  private static readonly WINDOW_MS = 5_000
  private frames: { atMs: number; durationMs: number }[] = []
  private snapshotGaps: { atMs: number; gapMs: number }[] = []
  private lastFrameMs: number | null = null
  private lastSnapshotMs: number | null = null

  recordFrame(nowMs: number): void {
    if (this.lastFrameMs !== null) this.frames.push({ atMs: nowMs, durationMs: nowMs - this.lastFrameMs })
    this.lastFrameMs = nowMs
    this.frames = this.recent(this.frames, nowMs)
  }

  recordSnapshot(nowMs: number): void {
    if (this.lastSnapshotMs !== null) this.snapshotGaps.push({ atMs: nowMs, gapMs: nowMs - this.lastSnapshotMs })
    this.lastSnapshotMs = nowMs
    this.snapshotGaps = this.recent(this.snapshotGaps, nowMs)
  }

  fps(): number {
    if (this.frames.length === 0) return 0
    const total = this.frames.reduce((sum, frame) => sum + frame.durationMs, 0)
    return (1000 * this.frames.length) / total
  }

  worstFrameMs(): number {
    return Math.max(0, ...this.frames.map((frame) => frame.durationMs))
  }

  worstSnapshotGapMs(): number {
    return Math.max(0, ...this.snapshotGaps.map((gap) => gap.gapMs))
  }

  private recent<T extends { atMs: number }>(entries: T[], nowMs: number): T[] {
    const cutoff = nowMs - PerfStats.WINDOW_MS
    return entries[0] && entries[0].atMs < cutoff ? entries.filter((entry) => entry.atMs >= cutoff) : entries
  }
}
