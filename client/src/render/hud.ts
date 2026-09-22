import type { ClientGame } from '../game/clientGame'
import { GameRules } from '../game/rules'
import { Palette } from '../game/tiles'
import type { SelfState } from '../net/protocol'
import type { GameSocket } from '../net/socket'
import type { AsciiGrid } from './asciiGrid'
import { scale } from './color'

export const HUD_TOP_ROWS = 1
export const HUD_BOTTOM_ROWS = 2

const BAR_WIDTH = 10
const FEED_VISIBLE_MS = 8_000
const FEED_FADE_MS = 1_500
const PANEL = 'rgba(7, 7, 10, 0.8)'

const HELP: Record<string, string> = {
  survivor: 'WASD move · Shift sprint · hold E: repair/revive/heal · E: locker · F light · Q rock · Space skill check',
  monster: 'WASD move · Space attack · hold E: take downed · E: search locker · Shift lunge · R sonar · T trap',
  spectator: 'spectating · Esc menu',
}

/** Status line on top, player state and controls at the bottom, event feed on the right. */
export function renderHud(grid: AsciiGrid, game: ClientGame, socket: GameSocket, now: number): void {
  renderTopBar(grid, game, socket, now)
  if (game.phase !== 'playing' || !game.latest) return
  renderBottomBar(grid, game, game.latest.you)
  renderFeed(grid, game, now)
}

function renderTopBar(grid: AsciiGrid, game: ClientGame, socket: GameSocket, now: number): void {
  grid.fillCells(0, 0, grid.columns, 1, PANEL)
  let column = grid.drawText(0, 0, ' @scape ', Palette.hudAccent)
  if (game.roomId) column = grid.drawText(column, 0, `· ${game.roomId} `, Palette.hud)
  const match = game.match
  if (game.phase === 'playing' && match) {
    const role = match.role ?? 'spectator'
    column = grid.drawText(column, 0, `· ${role.toUpperCase()} `, role === 'monster' ? '#e74c3c' : '#f5f0e0')
    column = grid.drawText(column, 0, '· ', Palette.hud)
    for (let i = 0; i < match.generatorsNeeded; i++) {
      column = grid.drawText(column, 0, i < match.generatorsDone ? '■' : '□', i < match.generatorsDone ? '#58d68d' : '#6a5a30')
    }
    column = grid.drawText(column, 0, ` ${match.generatorsDone}/${match.generatorsNeeded} `, Palette.hud)
    const left = Math.max(0, match.timeLeftMs - (now - game.matchReceivedAtMs))
    const clock = formatClock(left)
    column = grid.drawText(column, 0, match.phase === 'endgame' ? `· GATE OPEN ${clock} ` : `· ${clock} `,
      match.phase === 'endgame' ? '#ffffff' : Palette.hud)
  }
  column = grid.drawText(column, 0, '· ', Palette.hud)
  if (socket.status === 'open') {
    grid.drawText(column, 0, `online ${socket.rttMs === null ? '…' : `${Math.round(socket.rttMs)}ms`}`, Palette.hudOk)
  } else {
    grid.drawText(column, 0, socket.status === 'connecting' ? 'connecting…' : 'offline, retrying…', Palette.hudWarn)
  }
}

function renderBottomBar(grid: AsciiGrid, game: ClientGame, you: SelfState): void {
  const statusRow = grid.rows - 2
  const helpRow = grid.rows - 1
  grid.fillCells(0, statusRow, grid.columns, 2, PANEL)
  if (you.spectating) {
    grid.drawText(1, statusRow, `spectating ${game.nameOf(you.id)}`, Palette.hud)
    grid.drawText(1, helpRow, HELP.spectator, Palette.hud)
    return
  }
  if (you.role === 'monster') renderMonsterStatus(grid, you, statusRow)
  else renderSurvivorStatus(grid, you, statusRow)
  grid.drawText(1, helpRow, `${HELP[you.role]} · M sound · F2 crt · Esc menu`, Palette.hud)
}

function renderSurvivorStatus(grid: AsciiGrid, you: SelfState, row: number): void {
  if (you.health === 'downed') {
    grid.drawText(1, row, `DOWN — bleeding out ${Math.ceil(you.bleedOutMs / 1000)}s · wait for a teammate`, '#e74c3c')
    return
  }
  const healthColor = you.health === 'healthy' ? Palette.hudOk : '#e74c3c'
  let column = grid.drawText(1, row, you.health, healthColor)
  column = grid.drawText(column, row, ' · stamina ', Palette.hud)
  column = grid.drawText(column, row, bar(you.stamina / GameRules.survivor.staminaMax), '#5dade2')
  column = grid.drawText(column, row, ` · light ${you.flashlight ? 'on' : 'off'} · rocks ${you.rocks}`, Palette.hud)
  if (you.hidden) column = grid.drawText(column, row, ' · HIDING (E to leave)', '#b07a45')
  if (you.activity !== 'none') {
    const label = ` · ${ACTIVITY_LABELS[you.activity]} `
    column = grid.drawText(column, row, label, '#f0c040')
    grid.drawText(column, row, `${bar(you.activityProgress)} ${Math.round(you.activityProgress * 100)}%`, '#f0c040')
  }
}

const ACTIVITY_LABELS: Record<string, string> = {
  repair: 'repairing',
  revive: 'reviving',
  heal: 'healing',
  catch: 'taking',
}

function renderMonsterStatus(grid: AsciiGrid, you: SelfState, row: number): void {
  const ability = (name: string, ms: number) => ({
    text: ms > 0 ? `${name} ${Math.ceil(ms / 1000)}s` : `${name} ready`,
    color: ms > 0 ? Palette.hud : Palette.hudOk,
  })
  const parts = [
    ability('attack', you.cooldowns.attackMs),
    ability('lunge', you.cooldowns.lungeMs),
    you.sonarActive ? { text: 'SONAR ACTIVE', color: '#e74c3c' } : ability('sonar', you.cooldowns.sonarMs),
    { text: `traps ${you.trapsLeft}`, color: you.trapsLeft > 0 && you.cooldowns.trapMs === 0 ? Palette.hudOk : Palette.hud },
  ]
  let column = 1
  parts.forEach((part, index) => {
    if (index > 0) column = grid.drawText(column, row, ' · ', Palette.hud)
    column = grid.drawText(column, row, part.text, part.color)
  })
  if (you.activity === 'catch') {
    column = grid.drawText(column, row, ' · taking ', '#e74c3c')
    grid.drawText(column, row, bar(you.activityProgress), '#e74c3c')
  }
}

function renderFeed(grid: AsciiGrid, game: ClientGame, now: number): void {
  const visible = game.feed.filter((line) => now - line.atMs < FEED_VISIBLE_MS)
  visible.forEach((line, index) => {
    const age = now - line.atMs
    const fade = age > FEED_VISIBLE_MS - FEED_FADE_MS ? (FEED_VISIBLE_MS - age) / FEED_FADE_MS : 1
    const text = ` ${line.text} `
    const column = grid.columns - [...text].length - 1
    grid.fillCells(column, HUD_TOP_ROWS + 1 + index, [...text].length, 1, PANEL)
    grid.drawText(column, HUD_TOP_ROWS + 1 + index, text, fade < 1 ? scale(line.color, fade) : line.color)
  })
}

export function bar(fraction: number, width = BAR_WIDTH): string {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`
}
