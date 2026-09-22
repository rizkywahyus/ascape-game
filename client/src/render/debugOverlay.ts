import type { ClientGame } from '../game/clientGame'
import { Palette } from '../game/tiles'
import type { GameSocket } from '../net/socket'
import type { AsciiGrid } from './asciiGrid'

const PANEL_BACKGROUND = 'rgba(7, 7, 10, 0.85)'
const BANDWIDTH_WINDOW_MS = 1_000

/** Netcode diagnostics, toggled with F3. */
export class DebugOverlay {
  visible = false
  private readonly grid: AsciiGrid
  private bandwidthSampleStart = 0
  private bandwidthSampleBytes = 0
  private bytesPerSecond = 0

  constructor(grid: AsciiGrid) {
    this.grid = grid
  }

  render(game: ClientGame, socket: GameSocket, nowMs: number): void {
    this.updateBandwidth(socket, nowMs)
    if (!this.visible) return

    const predicted = game.predicted?.state
    const server = game.latest?.you
    const lines = [
      '┌─ netcode (F3) ─────────────────┐',
      `│ rtt          ${pad(socket.rttMs === null ? '-' : `${socket.rttMs.toFixed(1)} ms`)}│`,
      `│ server tick  ${pad(String(game.latest?.tick ?? '-'))}│`,
      `│ ack seq      ${pad(String(game.latest?.ackSeq ?? '-'))}│`,
      `│ pending in   ${pad(String(game.predicted?.pendingCount ?? '-'))}│`,
      `│ snap buffer  ${pad(String(game.buffer.size))}│`,
      `│ predicted    ${pad(predicted ? `${predicted.position.x},${predicted.position.y}` : '-')}│`,
      `│ server       ${pad(server ? `${server.x},${server.y}` : '-')}│`,
      `│ corrections  ${pad(String(game.predicted?.corrections ?? 0))}│`,
      `│ download     ${pad(`${(this.bytesPerSecond / 1024).toFixed(1)} KB/s`)}│`,
      `│ fps          ${pad(game.perf.fps().toFixed(0))}│`,
      `│ worst frame  ${pad(`${game.perf.worstFrameMs().toFixed(0)} ms (5s)`)}│`,
      `│ worst snap   ${pad(`${game.perf.worstSnapshotGapMs().toFixed(0)} ms (5s)`)}│`,
      '└────────────────────────────────┘',
    ]
    const width = [...lines[0]].length
    this.grid.fillCells(1, 1, width, lines.length, PANEL_BACKGROUND)
    lines.forEach((line, index) => this.grid.drawText(1, 1 + index, line, Palette.hudOk))
  }

  private updateBandwidth(socket: GameSocket, nowMs: number): void {
    if (nowMs - this.bandwidthSampleStart < BANDWIDTH_WINDOW_MS) return
    const elapsedSeconds = (nowMs - this.bandwidthSampleStart) / 1000
    this.bytesPerSecond = (socket.bytesReceived - this.bandwidthSampleBytes) / elapsedSeconds
    this.bandwidthSampleStart = nowMs
    this.bandwidthSampleBytes = socket.bytesReceived
  }
}

const VALUE_WIDTH = 18

function pad(value: string): string {
  return value.padEnd(VALUE_WIDTH).slice(0, VALUE_WIDTH)
}
