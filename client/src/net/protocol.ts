/** Wire types. shared/protocol.md is the source of truth; keep in sync with the server's DTOs. */

export interface Envelope<T extends string = string, D = unknown> {
  t: T
  d: D
}

export type RolePreference = 'monster' | 'survivor' | 'any'
export type Role = 'monster' | 'survivor'
export type Health = 'healthy' | 'injured' | 'downed' | 'caught' | 'escaped'
export type Activity = 'none' | 'repair' | 'revive' | 'heal' | 'catch'

export const Actions = {
  attack: 'attack',
  flashlight: 'flashlight',
  throw: 'throw',
  lunge: 'ability:lunge',
  sonar: 'ability:sonar',
  trap: 'ability:trap',
  skillCheck: 'skillcheck',
} as const
export type Action = (typeof Actions)[keyof typeof Actions]

// Client → server
export interface InputPayload {
  seq: number
  dx: -1 | 0 | 1
  dy: -1 | 0 | 1
  sprint: boolean
  interact: boolean
  actions: Action[]
  /** Snapshot tick shown for other characters when this input was made (lag compensation). */
  viewTick?: number
}

export interface ClientMessages {
  queue: { rolePref: RolePreference }
  join: { roomId: string; rolePref: RolePreference }
  leave: Record<string, never>
  input: InputPayload
  ping: { ts: number }
  chat: { text: string }
  /** Freeze or resume the lobby countdown while a group gathers. */
  hold: { hold: boolean }
}

// Server → client
export interface MapData {
  id: string
  rows: string[]
}
export interface WelcomePayload {
  playerId: string
  roomId: string
  tickRate: number
  serverTick: number
  map: MapData
}
export interface LobbyPayload {
  /** Also the room code players share to join this room. */
  roomId: string
  members: { name: string; rolePref: RolePreference; isBot: boolean; you: boolean; host: boolean }[]
  capacity: number
  startsInMs: number
  /** The countdown is frozen until the host resumes it; players may still join meanwhile. */
  held: boolean
}
export interface RosterEntry {
  entityId: number
  role: Role
  name: string
  isBot: boolean
  health: Health
}
export interface MatchPayload {
  phase: 'playing' | 'endgame'
  role: Role | null
  entityId: number | null
  spectatingId: number | null
  generatorsTotal: number
  generatorsNeeded: number
  generatorsDone: number
  gateOpen: boolean
  timeLeftMs: number
  roster: RosterEntry[]
}
export interface SelfState {
  id: number
  x: number
  y: number
  moveProgress: number
  role: Role
  health: Health
  hidden: boolean
  canMove: boolean
  moveSpeed: number
  sprintSpeed: number
  stamina: number
  flashlight: boolean
  rocks: number
  activity: Activity
  activityProgress: number
  terror: number
  bleedOutMs: number
  cooldowns: { attackMs: number; lungeMs: number; sonarMs: number; trapMs: number }
  trapsLeft: number
  sonarActive: boolean
  skillCheck: { startsInMs: number; windowMs: number } | null
  spectating: boolean
}
export interface EntityView {
  id: number
  kind: Role
  x: number
  y: number
  glyph: string
  color: string
  name: string
  health: Health
  flashlight: boolean
  activity: Activity
}
export interface GeneratorView {
  id: number
  x: number
  y: number
  progress: number | null
  done: boolean
}
export interface SnapshotPayload {
  tick: number
  ackSeq: number
  you: SelfState
  entities: EntityView[]
  generators: GeneratorView[]
  traps: { x: number; y: number }[]
  trails: { x: number; y: number; age: number }[]
  sounds: { kind: string; dx: number; dy: number; intensity: number }[]
  /** Dev-only (server flag ascape.debug.bot-view): every bot's state and planned path. */
  bots?: { id: number; state: string; path: { x: number; y: number }[] }[]
}
export interface EventPayload {
  kind:
    | 'hit'
    | 'downed'
    | 'caught'
    | 'revive'
    | 'escaped'
    | 'generator_done'
    | 'gate_open'
    | 'sonar'
    | 'trap'
    | 'skill_check'
  data: Record<string, number | boolean>
}
export interface PlayerResult {
  entityId: number
  name: string
  role: Role
  isBot: boolean
  escaped: boolean
  caught: boolean
  generators: number
  hits: number
  downs: number
  catches: number
  revives: number
  score: number
}
export interface ResultPayload {
  winner: 'survivors' | 'monster'
  players: PlayerResult[]
  nextLobbyInMs: number
}

export interface ServerMessages {
  welcome: WelcomePayload
  lobby: LobbyPayload
  match: MatchPayload
  snapshot: SnapshotPayload
  event: EventPayload
  takeover: { entityId: number | null; reason: string }
  result: ResultPayload
  chat: { from: string; text: string; ts: number }
  pong: { ts: number; serverTs: number }
  error: { code: string; msg: string }
}
