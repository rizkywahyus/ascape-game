import { readStick } from './joystick'
import type { KeyboardInput } from './keyboard'

/** Which controls to show: none (menus), only menu/zoom (lobby, results, spectating), or a role's full set. */
export type TouchMode = 'hidden' | 'waiting' | 'survivor' | 'monster'

interface ButtonSpec {
  readonly label: string
  /** The keyboard key this button stands in for (see ClientGame's ACTION_KEYS and KeyboardInput). */
  readonly code: string
}

/** First entry is the big thumb button; the rest fan out around it. */
const BUTTONS: Record<'survivor' | 'monster', readonly ButtonSpec[]> = {
  survivor: [
    { label: 'SKILL', code: 'Space' },
    { label: 'USE', code: 'KeyE' },
    { label: 'LIGHT', code: 'KeyF' },
    { label: 'ROCK', code: 'KeyQ' },
  ],
  monster: [
    { label: 'ATTACK', code: 'Space' },
    { label: 'USE', code: 'KeyE' },
    { label: 'LUNGE', code: 'ShiftLeft' },
    { label: 'SONAR', code: 'KeyR' },
    { label: 'TRAP', code: 'KeyT' },
  ],
}

const SPRINT_KEY = 'ShiftLeft'
/** How far (CSS px) the thumb can push the stick; further out is clamped. */
const STICK_REACH_PX = 56
/** Distance (CSS px) from the big button's centre to the small ones, and the arc they sit on. */
const FAN_RADIUS_PX = 92
const FAN_FROM_DEGREES = 180
const FAN_TO_DEGREES = 270

export interface TouchCallbacks {
  onMenu(): void
  onZoom(step: number): void
  /** Freeze or resume the lobby countdown (the keyboard's H). */
  onHold(hold: boolean): void
}

/** True on phones and tablets: their primary pointer is a finger. */
export function prefersTouch(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

/**
 * On-screen controls for touch screens. They press the same keys a keyboard player would (through
 * KeyboardInput's virtual keys), so the game, prediction and server see no difference.
 */
export class TouchControls {
  /** Whether touch controls are in use: from the start on touch devices, or after the first finger touch. */
  active = prefersTouch()

  private readonly keyboard: KeyboardInput
  private readonly root: HTMLElement
  private readonly stickBase: HTMLElement
  private readonly stickKnob: HTMLElement
  private readonly buttons: HTMLElement
  private readonly holdButton: HTMLElement
  private lobbyHeld: boolean | null = null
  private mode: TouchMode = 'hidden'
  private stickPointer: number | null = null
  private stickOrigin = { x: 0, y: 0 }
  private readonly stickHeld = new Set<string>()
  private readonly buttonHeld = new Set<string>()

  constructor(keyboard: KeyboardInput, callbacks: TouchCallbacks) {
    this.keyboard = keyboard
    this.root = element('div', 'touch')
    this.root.hidden = true
    const stickZone = element('div', 'touch-stick-zone')
    this.stickBase = element('div', 'touch-stick')
    this.stickKnob = element('div', 'touch-stick-knob')
    this.stickBase.append(this.stickKnob)
    stickZone.append(this.stickBase)
    this.buttons = element('div', 'touch-buttons')
    const top = element('div', 'touch-top')
    this.holdButton = this.tapButton('⏸ hold', () => callbacks.onHold(!this.lobbyHeld))
    this.holdButton.hidden = true
    top.append(
      this.tapButton('≡ menu', () => {
        if (this.mode === 'waiting' || confirm('Leave the match?')) callbacks.onMenu()
      }),
      this.tapButton('−', () => callbacks.onZoom(-1)),
      this.tapButton('+', () => callbacks.onZoom(1)),
      this.holdButton,
    )
    const rotateHint = element('div', 'touch-rotate')
    rotateHint.textContent = 'turn your phone sideways for a wider view'
    this.root.append(stickZone, this.buttons, top, rotateHint)
    document.body.append(this.root)
    this.bindStick(stickZone)
    this.show()

    window.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || this.active) return
      this.active = true
      this.show()
    })
  }

  setMode(mode: TouchMode): void {
    if (mode === this.mode) return
    this.releaseAll()
    this.mode = mode
    this.buttons.replaceChildren(...(mode === 'survivor' || mode === 'monster' ? this.actionButtons(BUTTONS[mode]) : []))
    this.stickBase.parentElement!.hidden = mode === 'waiting'
    this.show()
  }

  /** `held` from the lobby, or null outside it: hides the button. */
  setHoldState(held: boolean | null): void {
    if (held === this.lobbyHeld) return
    this.lobbyHeld = held
    this.holdButton.hidden = held === null
    this.holdButton.textContent = held ? '▶ start' : '⏸ hold'
  }

  private show(): void {
    const visible = this.active && this.mode !== 'hidden'
    this.root.hidden = !visible
    document.body.classList.toggle('touch-ui', this.active)
  }

  private actionButtons(specs: readonly ButtonSpec[]): HTMLElement[] {
    return specs.map((spec, index) => {
      const button = element('div', index === 0 ? 'touch-button primary' : 'touch-button')
      button.textContent = spec.label
      if (index > 0) {
        const fan = specs.length > 2 ? (index - 1) / (specs.length - 2) : 0
        const angle = ((FAN_FROM_DEGREES + (FAN_TO_DEGREES - FAN_FROM_DEGREES) * fan) * Math.PI) / 180
        button.style.transform = `translate(${Math.cos(angle) * FAN_RADIUS_PX}px, ${Math.sin(angle) * FAN_RADIUS_PX}px)`
      }
      this.holdable(button, spec.code)
      return button
    })
  }

  /** Pressed while a finger is on it, like holding the key; each finger is tracked on its own. */
  private holdable(button: HTMLElement, code: string): void {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      button.setPointerCapture(event.pointerId)
      button.classList.add('down')
      this.buttonHeld.add(code)
      this.keyboard.pressVirtual(code)
    })
    const release = () => {
      button.classList.remove('down')
      this.buttonHeld.delete(code)
      this.keyboard.releaseVirtual(code)
    }
    button.addEventListener('pointerup', release)
    button.addEventListener('pointercancel', release)
  }

  private tapButton(label: string, onTap: () => void): HTMLElement {
    const button = element('div', 'touch-button small')
    button.textContent = label
    button.addEventListener('pointerdown', (event) => event.preventDefault())
    button.addEventListener('click', onTap)
    return button
  }

  /** The stick appears wherever the thumb lands in the left half, then follows it. */
  private bindStick(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (event) => {
      if (this.stickPointer !== null) return
      event.preventDefault()
      zone.setPointerCapture(event.pointerId)
      this.stickPointer = event.pointerId
      this.stickOrigin = { x: event.clientX, y: event.clientY }
      this.stickBase.classList.add('engaged')
      this.stickBase.style.left = `${event.clientX}px`
      this.stickBase.style.top = `${event.clientY}px`
      this.moveStick(0, 0)
    })
    zone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.stickPointer) return
      this.moveStick(event.clientX - this.stickOrigin.x, event.clientY - this.stickOrigin.y)
    })
    const end = (event: PointerEvent) => {
      if (event.pointerId !== this.stickPointer) return
      this.releaseStick()
    }
    zone.addEventListener('pointerup', end)
    zone.addEventListener('pointercancel', end)
  }

  private moveStick(dx: number, dy: number): void {
    const length = Math.hypot(dx, dy)
    const clamp = length > STICK_REACH_PX ? STICK_REACH_PX / length : 1
    this.stickKnob.style.transform = `translate(${dx * clamp}px, ${dy * clamp}px)`
    const stick = readStick(dx, dy, STICK_REACH_PX)
    const wanted = new Set(stick.keys)
    // Survivors sprint by pushing to the edge; the monster's Shift is lunge, which has its own button.
    if (stick.sprint && this.mode === 'survivor') wanted.add(SPRINT_KEY)
    for (const code of this.stickHeld) {
      if (wanted.has(code)) continue
      this.stickHeld.delete(code)
      this.keyboard.releaseVirtual(code)
    }
    for (const code of wanted) {
      if (this.stickHeld.has(code)) continue
      this.stickHeld.add(code)
      this.keyboard.pressVirtual(code)
    }
  }

  private releaseStick(): void {
    this.stickPointer = null
    this.moveStick(0, 0)
    this.stickBase.classList.remove('engaged')
    this.stickBase.style.left = ''
    this.stickBase.style.top = ''
  }

  private releaseAll(): void {
    this.releaseStick()
    for (const code of this.buttonHeld) this.keyboard.releaseVirtual(code)
    this.buttonHeld.clear()
  }
}

function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}
