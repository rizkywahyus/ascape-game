import type { ClientMessages, Envelope, ServerMessages } from './protocol'

const PING_INTERVAL_MS = 2_000
const RECONNECT_BASE_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS = 10_000

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

type Handler<K extends keyof ServerMessages> = (payload: ServerMessages[K]) => void

/**
 * WebSocket with typed messages, automatic reconnect (exponential backoff) and RTT measurement.
 * `onOpen` handlers run after every (re)connect, so they can re-send `join`.
 */
export class GameSocket {
  status: ConnectionStatus = 'connecting'
  /** Smoothed round-trip time in ms, or null before the first pong. */
  rttMs: number | null = null
  /** Total characters of server messages received, for the debug overlay's bandwidth figure. */
  bytesReceived = 0

  private socket: WebSocket | null = null
  private readonly handlers = new Map<keyof ServerMessages, Set<Handler<never>>>()
  private readonly openHandlers = new Set<() => void>()
  private reconnectAttempts = 0
  private pingTimer: number | undefined
  private reconnectTimer: number | undefined
  private closedByClient = false
  private readonly urlProvider: () => string

  constructor(urlProvider: () => string) {
    this.urlProvider = urlProvider
    this.on('pong', ({ ts }) => this.recordRtt(performance.now() - ts))
  }

  connect(): void {
    this.closedByClient = false
    this.status = 'connecting'
    const socket = new WebSocket(this.urlProvider())
    this.socket = socket
    socket.addEventListener('open', () => {
      this.status = 'open'
      this.reconnectAttempts = 0
      this.pingTimer = window.setInterval(() => this.send('ping', { ts: performance.now() }), PING_INTERVAL_MS)
      this.openHandlers.forEach((handler) => handler())
    })
    socket.addEventListener('message', (event) => this.dispatch(event.data))
    socket.addEventListener('close', () => {
      window.clearInterval(this.pingTimer)
      if (this.socket !== socket) return
      this.status = 'closed'
      if (!this.closedByClient) this.scheduleReconnect()
    })
  }

  /** Closes for good (no reconnect). */
  close(): void {
    this.closedByClient = true
    window.clearTimeout(this.reconnectTimer)
    window.clearInterval(this.pingTimer)
    this.socket?.close()
    this.socket = null
    this.status = 'closed'
  }

  onOpen(handler: () => void): void {
    this.openHandlers.add(handler)
  }

  on<K extends keyof ServerMessages>(type: K, handler: Handler<K>): void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as Handler<never>)
  }

  /** Sends if connected; drops the message otherwise (inputs are useless once stale). */
  send<K extends keyof ClientMessages>(type: K, payload: ClientMessages[K]): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify({ t: type, d: payload }))
    return true
  }

  private dispatch(raw: unknown): void {
    if (typeof raw !== 'string') return
    this.bytesReceived += raw.length
    let envelope: Envelope
    try {
      envelope = JSON.parse(raw) as Envelope
    } catch (error) {
      console.error('Unparseable server message', error)
      return
    }
    const handlers = this.handlers.get(envelope.t as keyof ServerMessages)
    if (!handlers) return
    handlers.forEach((handler) => (handler as (payload: unknown) => void)(envelope.d))
  }

  private recordRtt(sampleMs: number): void {
    const SMOOTHING = 0.2
    this.rttMs = this.rttMs === null ? sampleMs : this.rttMs + (sampleMs - this.rttMs) * SMOOTHING
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS)
    this.reconnectAttempts++
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay)
  }
}
