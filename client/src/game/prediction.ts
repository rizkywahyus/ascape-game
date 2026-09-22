import { advance, type Direction, type IsWalkable, type MoveState } from './movement'

interface PendingInput {
  readonly seq: number
  readonly direction: Direction
  readonly speed: number
  /** The character could not move (hidden, trapped…) when this input was sent; the server skips movement too. */
  readonly frozen: boolean
}

/** Authoritative state of our own character as reported by the server. */
export interface ServerSelfState {
  readonly x: number
  readonly y: number
  readonly moveProgress: number
}

/**
 * Client-side prediction for the local character: inputs are applied immediately and remembered until the
 * server acknowledges them; each snapshot resets to the server state and replays the unacknowledged inputs.
 */
export class PredictedCharacter {
  state: MoveState
  /** Number of snapshots whose replayed result differed from what we had predicted. */
  corrections = 0
  private pending: PendingInput[] = []
  private readonly tickRate: number

  constructor(initial: MoveState, tickRate: number) {
    this.state = initial
    this.tickRate = tickRate
  }

  get pendingCount(): number {
    return this.pending.length
  }

  applyLocal(seq: number, direction: Direction, speed: number, isWalkable: IsWalkable, frozen = false): void {
    const input = { seq, direction, speed, frozen }
    this.pending.push(input)
    this.state = this.step(isWalkable, this.state, input)
  }

  reconcile(server: ServerSelfState, ackSeq: number, isWalkable: IsWalkable): void {
    this.pending = this.pending.filter((input) => input.seq > ackSeq)
    let replayed: MoveState = { position: { x: server.x, y: server.y }, progress: server.moveProgress }
    for (const input of this.pending) {
      replayed = this.step(isWalkable, replayed, input)
    }
    if (replayed.position.x !== this.state.position.x || replayed.position.y !== this.state.position.y) {
      this.corrections++
    }
    this.state = replayed
  }

  private step(isWalkable: IsWalkable, state: MoveState, input: PendingInput): MoveState {
    return input.frozen ? state : advance(isWalkable, state, input.direction, input.speed, this.tickRate)
  }
}
