import type { ClientGame } from '../game/clientGame'
import { Palette } from '../game/tiles'
import type { SelfState } from '../net/protocol'
import type { AsciiGrid } from './asciiGrid'
import { bar } from './hud'

const PANEL = 'rgba(10, 10, 14, 0.94)'
const BORDER = '#6a5a30'
const TITLE = '#f0a030'
const TEXT = '#c8c8c8'
const DIM = '#7a7a86'
const SKILL_WINDOW_COLOR = '#58d68d'
const SKILL_WAIT_COLOR = '#f0c040'
const SKILL_BAR_WIDTH = 24
/** The briefing sits under the top bar for the first seconds of a match, then gets out of the way. */
const MISSION_MS = 10_000
const MISSION_TOP_ROW = 2
/** Free hosting sleeps the server when idle; past this wait, say so instead of looking stuck. */
const SLOW_CONNECT_HINT_MS = 5_000

interface Line {
  readonly text: string
  readonly color?: string
}

/** Centred panels drawn on the grid: lobby, match result, skill check, connecting. */
export function renderOverlays(grid: AsciiGrid, game: ClientGame, now: number): void {
  switch (game.phase) {
    case 'connecting':
      box(grid, 'connecting', now - game.createdAtMs < SLOW_CONNECT_HINT_MS
        ? [{ text: 'looking for a match…', color: DIM }]
        : [{ text: 'waking the server…', color: DIM }, { text: 'free hosting sleeps when idle; up to a minute', color: DIM }])
      break
    case 'lobby':
      renderLobby(grid, game, now)
      break
    case 'result':
      renderResult(grid, game, now)
      break
    case 'playing':
      renderMission(grid, game, now)
      if (game.latest?.you.skillCheck && !game.latest.you.spectating) renderSkillCheck(grid, game.latest.you, now, game)
      break
  }
}

/** What this player is here to do, in their own words, while the match settles in. */
function renderMission(grid: AsciiGrid, game: ClientGame, now: number): void {
  const match = game.match
  const you = game.latest?.you
  if (!match || !you || you.spectating || now - game.matchStartedAtMs > MISSION_MS) return
  const generators = game.latest?.generators.length ?? match.generatorsNeeded
  const lines: Line[] = you.role === 'monster'
    ? [
        { text: 'hunt the survivors — two hits down one', color: TEXT },
        { text: 'hold E on a downed survivor to carry it off', color: TEXT },
        { text: 'stop them before they repair the generators and escape', color: DIM },
      ]
    : [
        { text: `repair ${match.generatorsNeeded} of the ${generators} generators — hold E at one`, color: TEXT },
        { text: 'then escape through the gate on the east side', color: TEXT },
        { text: 'the marker at the screen edge points the way', color: DIM },
      ]
  box(grid, 'your mission', lines, MISSION_TOP_ROW)
}

function renderLobby(grid: AsciiGrid, game: ClientGame, now: number): void {
  const lobby = game.lobby
  if (!lobby) {
    box(grid, 'lobby', [{ text: 'joining…', color: DIM }])
    return
  }
  const startsIn = Math.max(0, Math.ceil((lobby.startsInMs - (now - game.lobbyReceivedAtMs)) / 1000))
  const lines: Line[] = [
    { text: `room code  ${lobby.roomId}`, color: TITLE },
    { text: 'share it — friends join with it from the menu', color: DIM },
    { text: '' },
    ...lobby.members.map((member) => ({
      text: `${member.you ? '▸' : ' '} ${member.name.padEnd(18)} wants ${member.rolePref}${member.host ? '  (host)' : ''}`,
      color: member.you ? TITLE : TEXT,
    })),
    ...Array.from({ length: lobby.capacity - lobby.members.length }, () => ({ text: '  · open slot (bot)', color: DIM })),
    { text: '' },
    lobby.held
      ? { text: 'countdown held by the host — waiting for players', color: SKILL_WAIT_COLOR }
      : { text: `match starts in ${startsIn}s — bots fill empty slots`, color: Palette.hudOk },
    game.isHost()
      ? { text: lobby.held ? 'H: start the countdown' : 'H: hold the countdown', color: DIM }
      : { text: 'only the host can hold the countdown', color: DIM },
  ]
  box(grid, 'lobby', lines)
}

function renderResult(grid: AsciiGrid, game: ClientGame, now: number): void {
  const result = game.result
  if (!result) return
  const survivorsWon = result.winner === 'survivors'
  const nextIn = Math.max(0, Math.ceil((result.nextLobbyInMs - (now - game.resultReceivedAtMs)) / 1000))
  const selfId = game.match?.entityId
  const rows = [...result.players].sort((a, b) => b.score - a.score)
  const lines: Line[] = [
    {
      text: survivorsWon ? 'THE SURVIVORS ESCAPED' : 'THE MONSTER FEEDS',
      color: survivorsWon ? '#58d68d' : '#e74c3c',
    },
    { text: '' },
    { text: 'player              role      outcome   gens hits  score', color: DIM },
    ...rows.map((player) => {
      const outcome = player.role === 'monster' ? `${player.catches} taken` : player.escaped ? 'escaped' : 'caught'
      const name = player.name.slice(0, 18).padEnd(19)
      const hits = player.role === 'monster' ? player.hits : player.revives
      return {
        text: `${name} ${player.role.padEnd(9)} ${outcome.padEnd(9)} ${player.generators.toFixed(1).padStart(4)} ${String(hits).padStart(4)} ${String(player.score).padStart(6)}`,
        color: player.entityId === selfId ? TITLE : TEXT,
      }
    }),
    { text: '' },
    { text: `back to the lobby in ${nextIn}s · Esc for menu`, color: DIM },
  ]
  box(grid, 'result', lines)
}

/** A bar fills towards the window; press Space while it is green. */
function renderSkillCheck(grid: AsciiGrid, you: SelfState, now: number, game: ClientGame): void {
  const check = you.skillCheck!
  const receivedAgo = now - (game.buffer.lastReceivedAtMs ?? now)
  const untilOpen = check.startsInMs - receivedAgo
  const open = untilOpen <= 0
  const fraction = open ? 1 : 1 - untilOpen / (check.startsInMs + check.windowMs)
  const color = open ? SKILL_WINDOW_COLOR : SKILL_WAIT_COLOR
  const lines: Line[] = [
    { text: open ? '▶  PRESS SPACE  ◀' : 'steady…', color },
    { text: bar(fraction, SKILL_BAR_WIDTH), color },
  ]
  box(grid, 'skill check', lines, Math.floor(grid.rows * 0.7))
}

/** Box-drawn panel centred horizontally, vertically centred unless `top` is given. */
function box(grid: AsciiGrid, title: string, lines: readonly Line[], top?: number): void {
  const innerWidth = Math.max(...lines.map((line) => [...line.text].length), [...title].length + 4) + 2
  const width = innerWidth + 2
  const height = lines.length + 2
  const left = Math.max(0, Math.floor((grid.columns - width) / 2))
  const y = top ?? Math.max(1, Math.floor((grid.rows - height) / 2))
  grid.fillCells(left, y, width, height, PANEL)
  const titleText = `─ ${title} `
  grid.drawText(left, y, `┌${titleText}${'─'.repeat(Math.max(0, innerWidth - [...titleText].length))}┐`, BORDER)
  grid.drawText(left + 3, y, title, TITLE)
  lines.forEach((line, index) => {
    grid.drawText(left, y + 1 + index, '│', BORDER)
    grid.drawText(left + 2, y + 1 + index, line.text, line.color ?? TEXT)
    grid.drawText(left + width - 1, y + 1 + index, '│', BORDER)
  })
  grid.drawText(left, y + height - 1, `└${'─'.repeat(innerWidth)}┘`, BORDER)
}
