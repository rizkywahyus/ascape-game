# @scape protocol v1

Source of truth for every message exchanged over the game WebSocket (`/ws`).
Update this file **before** changing DTOs on the server or client.

Related shared files:

- `rules.json` — tick rate, speeds, timings and radii; both sides read the same values.
- `maps/tiles.json` — map character legend (kind, solidity, opacity, glyph, colour).
- `maps/*.map.txt` — maps; sent to clients in `welcome`.
- `fixtures/movement-cases.json` — movement cases both implementations must pass.

## Transport

- One WebSocket per client at `/ws?token=<supabase access token>`. A missing or invalid token gets HTTP 401 on the
  upgrade, unless the server runs with `AUTH_ALLOW_UNAUTHENTICATED=true` (then the client plays as `guest-xxxx`).
- Text frames, JSON encoded. Max inbound frame: 4 KiB.
- Envelope: `{ "t": "<type>", "d": { ... } }`

## World model

- The world is a grid. Positions are integer cells; `(0, 0)` is the top-left map character.
- Characters move **one cell per step**. Each tick a moving character gains `speed / tickRate` move progress;
  at `>= 1` it steps one cell and loses 1. Idle characters keep progress capped at 1, so the first step after
  standing still is immediate.
- A blocked diagonal slides along the free axis; diagonals never cut between two solid cells.
- Characters do not block each other. Gate cells (`E`) become walkable once the gate opens.

## Room lifecycle

`lobby` (countdown, humans gather) → `playing` → `endgame` (gate open, collapse timer) → `result` → `lobby` …

- **Room code**: `roomId` is the code players share; a friend joins that room with `join`.
- **Hold**: any player in a lobby may `hold` it. The countdown freezes and the room is skipped by matchmaking, so
  only players with the code arrive; resuming restarts the countdown from where it stopped.
- When the lobby countdown ends, roles are assigned: the monster goes to a player who prefers it (else `any`,
  else a bot); everyone else becomes a survivor; empty slots (1 monster + 4 survivors) are filled with bots.
- **Drop-in**: joining a running match takes over a bot (preferred role if possible), else spectates.
- **Drop-out**: a disconnected player's character is driven by a bot at once; the same player can reclaim it
  within 30 s (matchmaking routes them back).

## Client → Server

| type    | payload                                                        | notes |
|---------|----------------------------------------------------------------|-------|
| `queue` | `{ rolePref }`                                                 | matchmaking; `rolePref`: `monster`, `survivor`, `any` |
| `join`  | `{ roomId, rolePref }`                                         | join (or create) a room by id, `[a-z0-9-]{1,32}` |
| `leave` | `{}`                                                           | leave the current room |
| `input` | `{ seq, dx, dy, sprint, interact, actions: [], viewTick }`     | one message per client tick, see below |
| `chat`  | `{ text }`                                                     | 1–200 chars |
| `hold`  | `{ hold }`                                                     | lobby only; freezes or resumes the countdown |
| `ping`  | `{ ts }`                                                       | client clock, echoed back in `pong` |

### `input`

- `seq`: strictly increasing per connection, starts at 1.
- `dx`, `dy`: `-1 | 0 | 1` (server clamps anything else).
- `sprint`, `interact`: held state this tick. `interact` is a press for lockers (hide/leave; the monster searches
  one, which counts as a hit on whoever hides inside) and held, while not moving, to channel: survivors repair,
  revive a downed teammate or heal an injured one; the monster carries off a downed survivor.
- `actions`: one-shot presses this tick: `attack`, `flashlight`, `throw`, `ability:lunge`, `ability:sonar`,
  `ability:trap`, `skillcheck`. Unknown actions are ignored. An `attack` pressed while on cooldown is buffered and
  fires automatically if the cooldown ends within 0.5 s. Attacks resolve after the tick's movement, from the cell
  the monster just stepped into (what the player sees with prediction). A swing slows the monster for
  `attackSlowSeconds` whether it hits or not, so the client can predict it; the cooldown is longer after a hit.
- `viewTick` (optional): the snapshot tick the client was showing *other* characters at when the input was made
  (they are rendered in the past, interpolated). The server uses it for **lag compensation**: an attack is checked
  against where survivors were at that tick as well as where they are now. The rewind is capped at 6 ticks (300 ms).
- The server consumes **at most one input per character per tick**, in `seq` order. A character with no pending
  input is not simulated that tick, so the server state after `ackSeq` is exactly what the client predicts after
  applying inputs up to `ackSeq`. The backlog is capped at 3 inputs so a burst cannot leave every later press
  permanently late; trimmed inputs lose their movement but their `actions` and held `interact` are merged into the
  next input, so presses are never lost. Reconciliation absorbs the difference.

## Server → Client

| type       | payload | notes |
|------------|---------|-------|
| `welcome`  | `{ playerId, roomId, tickRate, serverTick, map: { id, rows: [] } }` | after joining a room |
| `lobby`    | `{ roomId, members: [{ name, rolePref, isBot, you }], capacity, startsInMs, held }` | lobby phase, on change and every second |
| `match`    | see below | on start, on every event, every second |
| `snapshot` | see below | every tick while a match runs |
| `event`    | `{ kind, data: { … } }` | see event kinds |
| `takeover` | `{ entityId, reason }` | `entityId` null = spectating |
| `result`   | `{ winner, players: [...], nextLobbyInMs }` | `winner`: `survivors` or `monster` |
| `chat`     | `{ from, text, ts }` | |
| `pong`     | `{ ts, serverTs }` | |
| `error`    | `{ code, msg }` | |

### `match`

`{ phase, role, entityId, spectatingId, generatorsTotal, generatorsNeeded, generatorsDone, gateOpen, timeLeftMs,
roster: [{ entityId, role, name, isBot, health }] }`

- `phase`: `playing` or `endgame`. `timeLeftMs` counts down the match (playing) or the collapse (endgame).
- `role`/`entityId` are null for spectators; `spectatingId` is the character whose view they receive.

### `snapshot`

`{ tick, ackSeq, you, entities, generators, traps, trails, sounds }` — **filtered per receiver on the server**:
nothing the receiver may not see is ever sent.

- `you`: `{ id, x, y, moveProgress, role, health, hidden, canMove, moveSpeed, sprintSpeed, stamina, flashlight,
  rocks, activity (`none`/`repair`/`revive`/`heal`/`catch`), activityProgress, terror, bleedOutMs, cooldowns: { attackMs, lungeMs, sonarMs, trapMs },
  trapsLeft, sonarActive, skillCheck: { startsInMs, windowMs } | null, spectating }`.
  `moveSpeed`/`sprintSpeed` are the speeds to predict with; `terror` (0–1) drives the heartbeat.
- `entities`: `[{ id, kind, x, y, glyph, color, name, health, flashlight, activity }]`
- `generators`: `[{ id, x, y, progress, done }]`; `progress` is null when out of sight.
- `traps`: `[{ x, y }]` — the monster sees its own; survivors only within 2 cells in sight.
- `trails`: `[{ x, y, age }]` — monster only; `age` 0 (fresh) → 1 (gone).
- `sounds`: `[{ kind, dx, dy, intensity }]` — monster only; a unit direction and loudness, never a position.
  Kinds: `footsteps`, `repair`, `locker`, `rock`, `trap`, `scream`, `generator`, `explosion`.
- `bots` (dev only, server flag `ascape.debug.bot-view`): `[{ id, state, path: [{ x, y }] }]`. Absent otherwise;
  it deliberately breaks the visibility rules, so never enable it in production.

### Visibility rules

- Survivors always see teammates. They see the monster within 2 cells, or inside their light radius
  (flashlight on: 8, off: 3) with line of sight.
- The monster sees survivors within 8 cells in line of sight, survivors with a flashlight on within 12 cells in
  line of sight, and every survivor within 24 cells while sonar is active.
- Survivors hiding in a locker are visible to nobody.

### Event kinds

| kind             | data |
|------------------|------|
| `hit`            | `{ attackerId, victimId }` |
| `downed`         | `{ victimId }` |
| `caught`         | `{ victimId, byId? }` (no `byId`: bled out) |
| `revive`         | `{ victimId, byId }` |
| `escaped`        | `{ survivorId }` |
| `generator_done` | `{ generatorId, x, y }` |
| `gate_open`      | `{}` |
| `sonar`          | `{ monsterId }` |
| `trap`           | `{ victimId }` |
| `skill_check`    | `{ survivorId, success }` |

### Error codes

| code             | meaning |
|------------------|---------|
| `bad_message`    | unparseable envelope or payload |
| `unknown_type`   | unsupported `t` |
| `not_in_room`    | `input`/`chat` before joining |
| `bad_room_id`    | `roomId` fails validation |
