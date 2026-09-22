import { MOUSE_LEFT, type KeyboardInput } from '../input/keyboard'
import {
  Actions,
  type Action,
  type EntityView,
  type EventPayload,
  type LobbyPayload,
  type MatchPayload,
  type ResultPayload,
  type Role,
  type RolePreference,
  type SnapshotPayload,
  type WelcomePayload,
} from '../net/protocol'
import type { GameSocket } from '../net/socket'
import { SnapshotBuffer, type InterpolatedEntity } from './interpolation'
import type { IsWalkable } from './movement'
import { PredictedCharacter } from './prediction'
import { GameRules } from './rules'
import { PerfStats } from './perfStats'
import { TileMap } from './tileMap'

/** Remote entities are drawn this far in the past so there are two snapshots to interpolate between. */
const INTERPOLATION_DELAY_MS = 100
/** Our own character slides between cells over this long instead of snapping. */
const SELF_GLIDE_MS = 60
const FEED_LIMIT = 6

/** One-shot key presses → actions, per role. Held keys (move, sprint, interact) are read directly. */
const ACTION_KEYS: Record<Role, Record<string, Action>> = {
  survivor: { KeyF: Actions.flashlight, KeyQ: Actions.throw, Space: Actions.skillCheck },
  monster: {
    Space: Actions.attack,
    KeyJ: Actions.attack,
    [MOUSE_LEFT]: Actions.attack,
    ShiftLeft: Actions.lunge,
    ShiftRight: Actions.lunge,
    KeyR: Actions.sonar,
    KeyT: Actions.trap,
  },
}

export type RoomPhase = 'connecting' | 'lobby' | 'playing' | 'result'

export interface RenderEntity extends EntityView {
  /** Fractional render position in cells. */
  readonly renderX: number
  readonly renderY: number
}

export interface FeedLine {
  readonly text: string
  readonly color: string
  readonly atMs: number
}

type EventListener = (event: EventPayload, game: ClientGame) => void
/** Fired the moment the player presses an action locally, before the server confirms it (instant feedback). */
type LocalActionListener = (action: Action, game: ClientGame) => void

/**
 * Networked game state on the client. Matchmakes, sends one input per server tick, predicts our own character,
 * reconciles against snapshots and interpolates everyone else.
 */
export class ClientGame {
  phase: RoomPhase = 'connecting'
  /** When matchmaking began (performance.now()), so a slow first connection can explain itself. */
  readonly createdAtMs = performance.now()
  roomId: string | null = null
  map: TileMap | null = null
  tickRate: number = GameRules.tickRate
  lobby: LobbyPayload | null = null
  match: MatchPayload | null = null
  result: ResultPayload | null = null
  latest: SnapshotPayload | null = null
  predicted: PredictedCharacter | null = null
  buffer = new SnapshotBuffer(GameRules.tickRate, INTERPOLATION_DELAY_MS)
  feed: FeedLine[] = []
  readonly perf = new PerfStats()
  /** Local clock (performance.now) when `match.timeLeftMs` was received. */
  matchReceivedAtMs = 0
  lobbyReceivedAtMs = 0
  resultReceivedAtMs = 0

  private readonly socket: GameSocket
  private readonly keyboard: KeyboardInput
  private readonly requestedRoom: string | null
  private readonly eventListeners: EventListener[] = []
  private readonly localActionListeners: LocalActionListener[] = []
  private readonly pendingActions = new Set<Action>()
  private nextSeq = 1
  private tickAccumulatorMs = 0
  /** Until when (local clock) our own swing slows us, predicted the moment we attack instead of a round trip later. */
  private predictedSlowUntilMs = 0
  /** Local clock of the last attack press that could not swing yet, for the HUD's "recharging" hint. */
  rejectedAttackAtMs = -Infinity
  private glideFrom: { x: number; y: number } | null = null
  private glideStartMs = 0

  constructor(socket: GameSocket, keyboard: KeyboardInput, rolePref: RolePreference, requestedRoom: string | null) {
    this.socket = socket
    this.keyboard = keyboard
    this.requestedRoom = requestedRoom
    socket.onOpen(() => {
      if (this.requestedRoom) socket.send('join', { roomId: this.requestedRoom, rolePref })
      else socket.send('queue', { rolePref })
    })
    socket.on('welcome', (welcome) => this.onWelcome(welcome))
    socket.on('lobby', (lobby) => this.onLobby(lobby))
    socket.on('match', (match) => this.onMatch(match))
    socket.on('snapshot', (snapshot) => this.onSnapshot(snapshot))
    socket.on('event', (event) => this.onEvent(event))
    socket.on('takeover', ({ reason }) => this.pushFeed(reason === 'spectating' ? 'spectating' : reason, '#7a7a86'))
    socket.on('result', (result) => this.onResult(result))
    socket.on('error', ({ code, msg }) => console.warn(`Server error ${code}: ${msg}`))
  }

  onGameEvent(listener: EventListener): void {
    this.eventListeners.push(listener)
  }

  onLocalAction(listener: LocalActionListener): void {
    this.localActionListeners.push(listener)
  }

  /** True if an attack pressed now would swing right away (by our latest knowledge of the cooldown). */
  attackReady(nowMs: number): boolean {
    const you = this.latest?.you
    if (!you || you.role !== 'monster') return false
    const sinceSnapshot = nowMs - (this.buffer.lastReceivedAtMs ?? nowMs)
    return you.cooldowns.attackMs - sinceSnapshot <= 0
  }

  /** Our role, or null when spectating / not in a match. */
  role(): Role | null {
    return this.match?.role ?? null
  }

  /** True while we are the lobby's host, the only player who may hold the countdown. */
  isHost(): boolean {
    return this.lobby?.members.some((member) => member.you && member.host) ?? false
  }

  /**
   * Freezes or resumes the lobby countdown on the server, so a group can gather with the room code before the
   * match starts. Ignored outside the lobby and for everyone but the host.
   */
  setHold(hold: boolean): void {
    if (this.phase !== 'lobby' || !this.isHost()) return
    this.socket.send('hold', { hold })
  }

  /** Records one-shot key presses; they go out with the next input. */
  queuePresses(codes: ReadonlySet<string>): void {
    const role = this.role()
    if (!role) return
    const now = performance.now()
    for (const code of codes) {
      const action = ACTION_KEYS[role][code]
      if (!action) continue
      this.pendingActions.add(action)
      if (action === Actions.attack) {
        if (this.attackReady(now)) this.predictedSlowUntilMs = now + GameRules.monster.attackSlowSeconds * 1000
        else this.rejectedAttackAtMs = now
      }
      this.localActionListeners.forEach((listener) => listener(action, this))
    }
  }

  /** Called every animation frame; emits inputs on a fixed timestep matching the server tick. */
  update(elapsedMs: number, nowMs: number): void {
    if (this.phase === 'result' && this.result && nowMs - this.resultReceivedAtMs >= this.result.nextLobbyInMs) {
      this.phase = 'lobby'
    }
    if (this.phase !== 'playing' || !this.predicted || this.latest?.you.spectating) return
    const tickMs = 1000 / this.tickRate
    // Cap the backlog after a stall (e.g. a backgrounded tab); the server would trim the excess anyway.
    this.tickAccumulatorMs = Math.min(this.tickAccumulatorMs + elapsedMs, tickMs * 3)
    while (this.tickAccumulatorMs >= tickMs) {
      this.tickAccumulatorMs -= tickMs
      this.stepInput(nowMs)
    }
  }

  /** The character whose eyes we see through: ours at its predicted position, or the spectated one. */
  self(nowMs: number): RenderEntity | null {
    const you = this.latest?.you
    if (!you) return null
    const appearance = this.latest!.entities.find((entity) => entity.id === you.id)
    if (!appearance) return null
    if (you.spectating || !this.predicted) return { ...appearance, renderX: you.x, renderY: you.y }
    const { x, y } = this.predicted.state.position
    const glide = this.glideFrom ? Math.min((nowMs - this.glideStartMs) / SELF_GLIDE_MS, 1) : 1
    const from = this.glideFrom ?? { x, y }
    return { ...appearance, x, y, renderX: from.x + (x - from.x) * glide, renderY: from.y + (y - from.y) * glide }
  }

  others(nowMs: number): InterpolatedEntity[] {
    const selfId = this.latest?.you.id
    return this.buffer.sample(nowMs).filter((entity) => entity.id !== selfId)
  }

  nameOf(entityId: number): string {
    return this.match?.roster.find((entry) => entry.entityId === entityId)?.name ?? `#${entityId}`
  }

  isWalkable: IsWalkable = (x, y) => {
    const map = this.map
    if (!map || !map.isInside(x, y)) return false
    const tile = map.tileAt(x, y)
    return !tile.solid || (tile.kind === 'gate' && (this.match?.gateOpen ?? false))
  }

  private stepInput(nowMs: number): void {
    const you = this.latest!.you
    const direction = this.keyboard.direction()
    const sprint = this.keyboard.sprint()
    const actions = [...this.pendingActions]
    this.pendingActions.clear()
    const seq = this.nextSeq++
    const sent = this.socket.send('input', {
      seq,
      dx: direction.dx,
      dy: direction.dy,
      sprint,
      interact: this.keyboard.interact(),
      actions,
      viewTick: Math.max(0, Math.floor(this.buffer.renderTick(nowMs) ?? 0)),
    })
    if (!sent || !this.predicted) return
    const moving = direction.dx !== 0 || direction.dy !== 0
    const slowed = you.role === 'monster' && nowMs < this.predictedSlowUntilMs
    const speed = slowed ? GameRules.monster.attackSlowSpeed : sprint && moving ? you.sprintSpeed : you.moveSpeed
    const before = this.predicted.state.position
    this.predicted.applyLocal(seq, direction, speed, this.isWalkable, !you.canMove)
    this.startGlideIfMoved(before, nowMs)
  }

  private startGlideIfMoved(before: { x: number; y: number }, nowMs: number): void {
    const after = this.predicted!.state.position
    if (after.x === before.x && after.y === before.y) return
    const distance = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y))
    this.glideFrom = distance > 1 ? null : before
    this.glideStartMs = nowMs
  }

  private onWelcome(welcome: WelcomePayload): void {
    this.roomId = welcome.roomId
    this.map = TileMap.parse(welcome.map.rows.join('\n'))
    this.tickRate = welcome.tickRate
    this.phase = 'lobby'
    this.resetMatchState()
  }

  private onLobby(lobby: LobbyPayload): void {
    this.lobby = lobby
    this.lobbyReceivedAtMs = performance.now()
    // The result screen stays up until its own timer ends (see update()).
    if (this.phase !== 'result') this.phase = 'lobby'
  }

  private onMatch(match: MatchPayload): void {
    if (this.phase !== 'playing') {
      this.resetMatchState()
      this.phase = 'playing'
    }
    this.match = match
    this.matchReceivedAtMs = performance.now()
  }

  private onSnapshot(snapshot: SnapshotPayload): void {
    if (this.phase !== 'playing' || (this.latest && snapshot.tick <= this.latest.tick)) return
    const nowMs = performance.now()
    this.perf.recordSnapshot(nowMs)
    const previousSelf = this.latest?.you
    this.latest = snapshot
    this.buffer.push(snapshot.tick, snapshot.entities, nowMs)

    const { you, ackSeq } = snapshot
    const controlChanged = !previousSelf || previousSelf.id !== you.id || previousSelf.spectating !== you.spectating
    if (you.spectating) {
      this.predicted = null
      return
    }
    if (!this.predicted || controlChanged) {
      this.predicted = new PredictedCharacter(
        { position: { x: you.x, y: you.y }, progress: you.moveProgress },
        this.tickRate,
      )
      this.glideFrom = null
      return
    }
    const before = this.predicted.state.position
    this.predicted.reconcile(you, ackSeq, this.isWalkable)
    this.startGlideIfMoved(before, nowMs)
  }

  private onEvent(event: EventPayload): void {
    const line = describeEvent(event, this)
    if (line) this.pushFeed(line.text, line.color)
    this.eventListeners.forEach((listener) => listener(event, this))
  }

  private onResult(result: ResultPayload): void {
    this.result = result
    this.resultReceivedAtMs = performance.now()
    this.phase = 'result'
    this.predicted = null
  }

  private resetMatchState(): void {
    this.match = null
    this.latest = null
    this.predicted = null
    this.result = null
    this.feed = []
    this.buffer = new SnapshotBuffer(this.tickRate, INTERPOLATION_DELAY_MS)
    this.pendingActions.clear()
  }

  private pushFeed(text: string, color: string): void {
    this.feed.push({ text, color, atMs: performance.now() })
    if (this.feed.length > FEED_LIMIT) this.feed.shift()
  }
}

function describeEvent(event: EventPayload, game: ClientGame): { text: string; color: string } | null {
  const name = (key: string) => game.nameOf(Number(event.data[key]))
  switch (event.kind) {
    case 'hit':
      return { text: `${name('victimId')} was hit`, color: '#e67e22' }
    case 'downed':
      return { text: `${name('victimId')} is down!`, color: '#e74c3c' }
    case 'caught':
      return {
        text: event.data.byId === undefined ? `${name('victimId')} bled out` : `${name('victimId')} was taken`,
        color: '#c0392b',
      }
    case 'revive':
      return { text: `${name('byId')} revived ${name('victimId')}`, color: '#58d68d' }
    case 'escaped':
      return { text: `${name('survivorId')} escaped`, color: '#f5f0e0' }
    case 'generator_done': {
      const match = game.match
      const done = match ? `${match.generatorsDone + 1}/${match.generatorsNeeded}` : ''
      return { text: `generator repaired ${done}`.trim(), color: '#f0c040' }
    }
    case 'gate_open':
      return { text: 'THE GATE IS OPEN', color: '#ffffff' }
    case 'sonar':
      return game.role() === 'monster' ? null : { text: 'the monster is listening…', color: '#c0392b' }
    case 'trap':
      return { text: `${name('victimId')} stepped in a trap`, color: '#e74c3c' }
    case 'skill_check':
      return event.data.success ? null : { text: 'a generator sparks loudly', color: '#e67e22' }
  }
}
