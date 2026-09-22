import { describe, expect, it } from 'vitest'
import { PerfStats } from './perfStats'

describe('PerfStats', () => {
  it('reports fps and the worst frame in the window', () => {
    const stats = new PerfStats()
    for (let t = 0; t <= 1000; t += 20) stats.recordFrame(t)
    stats.recordFrame(1200) // a 200 ms hitch
    expect(stats.fps()).toBeGreaterThan(40)
    expect(stats.worstFrameMs()).toBe(200)
  })

  it('forgets samples older than five seconds', () => {
    const stats = new PerfStats()
    stats.recordSnapshot(0)
    stats.recordSnapshot(300)
    stats.recordSnapshot(6_000)
    stats.recordSnapshot(6_050)
    expect(stats.worstSnapshotGapMs()).toBe(5_700)
    stats.recordSnapshot(11_100)
    stats.recordSnapshot(11_150)
    expect(stats.worstSnapshotGapMs()).toBe(5_050)
  })
})
