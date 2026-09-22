import type { Axis, Direction } from '../game/movement'

const UP_KEYS = ['KeyW', 'ArrowUp']
const DOWN_KEYS = ['KeyS', 'ArrowDown']
const LEFT_KEYS = ['KeyA', 'ArrowLeft']
const RIGHT_KEYS = ['KeyD', 'ArrowRight']
const SPRINT_KEYS = ['ShiftLeft', 'ShiftRight']
const INTERACT_KEYS = ['KeyE']

/** Pseudo key code reported by consumePresses() for a left mouse click. */
export const MOUSE_LEFT = 'MouseLeft'

/** Keys whose browser default (scrolling) must be suppressed while playing. */
const CAPTURED_KEYS = new Set([...UP_KEYS, ...DOWN_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS, 'Space', 'F2', 'F3', 'F4', 'Minus', 'Equal'])

/** Tracks held keys by physical code (layout independent) and one-shot presses since the last read. */
export class KeyboardInput {
  /** Off while menus are shown, so Space/arrows keep their normal meaning there. */
  private enabled = false
  private readonly held = new Set<string>()
  private readonly pressed = new Set<string>()

  constructor(target: Window) {
    target.addEventListener('keydown', (event) => {
      if (!this.enabled || isTypingTarget(event.target)) return
      if (CAPTURED_KEYS.has(event.code)) event.preventDefault()
      if (!event.repeat) this.pressed.add(event.code)
      this.held.add(event.code)
    })
    target.addEventListener('keyup', (event) => this.held.delete(event.code))
    // Left click counts as a press too (monster attack): some keyboards cannot register Space while two
    // movement keys are held (key ghosting).
    target.addEventListener('mousedown', (event) => {
      if (this.enabled && event.button === 0) this.pressed.add(MOUSE_LEFT)
    })
    // Keyup is never delivered once the window loses focus; drop everything so we don't keep walking.
    target.addEventListener('blur', () => this.held.clear())
  }

  direction(): Direction {
    return { dx: this.axis(LEFT_KEYS, RIGHT_KEYS), dy: this.axis(UP_KEYS, DOWN_KEYS) }
  }

  sprint(): boolean {
    return this.anyHeld(SPRINT_KEYS)
  }

  interact(): boolean {
    return this.anyHeld(INTERACT_KEYS)
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.held.clear()
    this.pressed.clear()
  }

  /** Codes pressed since the previous call (each press reported once). */
  consumePresses(): Set<string> {
    const presses = new Set(this.pressed)
    this.pressed.clear()
    return presses
  }

  private anyHeld(codes: readonly string[]): boolean {
    return codes.some((code) => this.held.has(code))
  }

  private axis(negative: readonly string[], positive: readonly string[]): Axis {
    const neg = this.anyHeld(negative)
    const pos = this.anyHeld(positive)
    return neg === pos ? 0 : neg ? -1 : 1
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
}
