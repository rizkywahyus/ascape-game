import type { ClientGame } from '../game/clientGame'
import { Actions, type EventPayload } from '../net/protocol'

const MASTER_VOLUME = 0.35
const HEARTBEAT_MIN_BPM = 60
const HEARTBEAT_MAX_BPM = 150
const MUTE_STORAGE_KEY = 'ascape.muted'

/**
 * Tiny synthesised sound set (WebAudio oscillators and noise, no assets): heartbeat for survivors, and short cues
 * for hits, generators, the gate, sonar, traps and skill checks. Browsers only allow audio after a user gesture,
 * so {@link unlock} must be called from one (e.g. the "Find match" click).
 */
export class AudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private nextHeartbeatAt = 0
  private skillCheckShown = false
  muted = readMuted()

  unlock(): void {
    if (this.context) {
      void this.context.resume()
      return
    }
    try {
      this.context = new AudioContext()
    } catch (error) {
      console.warn('WebAudio unavailable; playing silently', error)
      return
    }
    this.master = this.context.createGain()
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME
    this.master.connect(this.context.destination)
    this.noiseBuffer = createNoise(this.context)
  }

  toggleMute(): void {
    this.muted = !this.muted
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, this.muted ? '1' : '0')
    } catch {
      // Storage may be blocked (private mode); muting still works for this session.
    }
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_VOLUME
  }

  attach(game: ClientGame): void {
    game.onGameEvent((event, current) => this.onEvent(event, current))
    game.onLocalAction((action, current) => {
      if (action === Actions.attack && current.attackReady(performance.now())) this.noise(0.12, 2200, 0.35) // whoosh
    })
  }

  /** Called every frame: heartbeat pacing and the skill-check cue. */
  update(game: ClientGame, nowMs: number): void {
    const you = game.latest?.you
    if (!this.context || !you || game.phase !== 'playing') return
    if (you.role === 'survivor' && you.terror > 0 && !you.spectating && nowMs >= this.nextHeartbeatAt) {
      const bpm = HEARTBEAT_MIN_BPM + (HEARTBEAT_MAX_BPM - HEARTBEAT_MIN_BPM) * you.terror
      this.heartbeat(0.4 + 0.6 * you.terror)
      this.nextHeartbeatAt = nowMs + 60_000 / bpm
    }
    const skillCheckShown = you.skillCheck !== null && !you.spectating
    if (skillCheckShown && !this.skillCheckShown) this.tone(1320, 0.08, 'square', 0.25)
    this.skillCheckShown = skillCheckShown
  }

  private onEvent(event: EventPayload, game: ClientGame): void {
    const selfId = game.latest?.you.id
    switch (event.kind) {
      case 'hit':
        this.noise(0.18, 900, event.data.victimId === selfId ? 0.9 : 0.4)
        this.tone(110, 0.25, 'sawtooth', 0.35)
        break
      case 'downed':
        this.sweep(220, 70, 0.6, 'sawtooth', 0.35)
        break
      case 'caught':
        this.sweep(160, 40, 1.0, 'triangle', 0.4)
        break
      case 'revive':
        this.sweep(330, 660, 0.3, 'sine', 0.3)
        break
      case 'generator_done':
        ;[523, 659, 784].forEach((frequency, i) => this.tone(frequency, 0.35, 'triangle', 0.3, i * 0.09))
        break
      case 'gate_open':
        ;[392, 523, 659, 784].forEach((frequency, i) => this.tone(frequency, 1.2, 'sine', 0.25, i * 0.12))
        break
      case 'sonar':
        this.sweep(1400, 300, 0.9, 'sine', 0.35)
        break
      case 'trap':
        this.tone(95, 0.12, 'square', 0.5)
        this.noise(0.1, 3000, 0.5)
        break
      case 'skill_check':
        if (event.data.survivorId === selfId) {
          if (event.data.success) this.tone(988, 0.12, 'sine', 0.3)
          else this.noise(0.4, 400, 0.7)
        }
        break
      case 'escaped':
        this.sweep(440, 880, 0.5, 'sine', 0.25)
        break
    }
  }

  private heartbeat(volume: number): void {
    this.tone(55, 0.12, 'sine', volume)
    this.tone(48, 0.12, 'sine', volume * 0.7, 0.18)
  }

  private tone(frequency: number, duration: number, type: OscillatorType, volume: number, delay = 0): void {
    this.sweep(frequency, frequency, duration, type, volume, delay)
  }

  private sweep(from: number, to: number, duration: number, type: OscillatorType, volume: number, delay = 0): void {
    const context = this.context
    if (!context || !this.master) return
    const start = context.currentTime + delay
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from, start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(to, 1), start + duration)
    gain.gain.setValueAtTime(volume, start)
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
    oscillator.connect(gain).connect(this.master)
    oscillator.start(start)
    oscillator.stop(start + duration)
  }

  private noise(duration: number, filterFrequency: number, volume: number): void {
    const context = this.context
    if (!context || !this.master || !this.noiseBuffer) return
    const source = context.createBufferSource()
    source.buffer = this.noiseBuffer
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterFrequency
    const gain = context.createGain()
    gain.gain.setValueAtTime(volume, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration)
    source.connect(filter).connect(gain).connect(this.master)
    source.start()
    source.stop(context.currentTime + duration)
  }
}

function createNoise(context: AudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
