import { AudioEngine } from './audio/audio'
import { Auth } from './auth/auth'
import { ClientGame } from './game/clientGame'
import { KeyboardInput } from './input/keyboard'
import type { RolePreference } from './net/protocol'
import { gameSocketUrl } from './net/serverUrl'
import { GameSocket } from './net/socket'
import { AsciiGrid } from './render/asciiGrid'
import { DebugOverlay } from './render/debugOverlay'
import { Effects } from './render/effects'
import { SceneRenderer } from './render/sceneRenderer'
import { Api } from './ui/api'
import { errorText, showAuthScreen } from './ui/authScreen'
import { showLobbyScreen } from './ui/lobbyScreen'
import './ui/styles.css'

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, monospace'
const FONT_LOAD_SPEC = '16px "JetBrains Mono"'
/** Crisp, readable text for the HUD, menus and labels. */
const HUD_FONT_PX = 15
/** The world is drawn with many tiny characters; - / = zoom between these bounds. */
const DEFAULT_WORLD_FONT_PX = 5
const MIN_WORLD_FONT_PX = 3
const MAX_WORLD_FONT_PX = 14
const ZOOM_OUT_KEY = 'Minus'
const ZOOM_IN_KEY = 'Equal'
const WORLD_FONT_STORAGE_KEY = 'ascape.worldFont.v2'
const DEBUG_TOGGLE_KEY = 'F3'
const BOT_DEBUG_TOGGLE_KEY = 'F4'
const CRT_TOGGLE_KEY = 'F2'
const MUTE_KEY = 'KeyM'
const CRT_CLASS = 'crt'
const LEAVE_KEY = 'Escape'

interface GameSession {
  readonly socket: GameSocket
  readonly game: ClientGame
}

async function loadFont(): Promise<void> {
  try {
    await document.fonts.load(FONT_LOAD_SPEC)
  } catch (error) {
    // The fallback monospace font still renders a playable grid.
    console.warn('JetBrains Mono failed to load; using fallback monospace', error)
  }
}

function readWorldFont(): number {
  try {
    const stored = Number(localStorage.getItem(WORLD_FONT_STORAGE_KEY))
    return stored >= MIN_WORLD_FONT_PX && stored <= MAX_WORLD_FONT_PX ? stored : DEFAULT_WORLD_FONT_PX
  } catch {
    return DEFAULT_WORLD_FONT_PX
  }
}

function storeWorldFont(size: number): void {
  try {
    localStorage.setItem(WORLD_FONT_STORAGE_KEY, String(size))
  } catch {
    // Storage may be blocked (private mode); the zoom still applies for this session.
  }
}

/** `?room=<id>` joins a specific (private) room instead of matchmaking. */
function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get('room')
}

async function start(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#screen')
  const worldCanvas = document.querySelector<HTMLCanvasElement>('#world')
  const ui = document.querySelector<HTMLElement>('#ui')
  if (!canvas || !worldCanvas || !ui) throw new Error('#screen, #world or #ui missing from index.html')

  await loadFont()

  const auth = new Auth()
  const api = new Api(() => auth.accessToken())
  const keyboard = new KeyboardInput(window)
  const grid = new AsciiGrid(canvas, FONT_FAMILY, HUD_FONT_PX)
  let worldFontPx = readWorldFont()
  const effects = new Effects()
  const renderer = new SceneRenderer(grid, effects, worldCanvas)
  const debugOverlay = new DebugOverlay(grid)
  const audio = new AudioEngine()
  let session: GameSession | null = null
  let rolePreference: RolePreference = 'any'

  const showMenu = async () => {
    ui.hidden = false
    if (auth.enabled && !(await auth.restore())) await showAuthScreen(ui, auth)
    showLobbyScreen(ui, api, auth.enabled, rolePreference, {
      onPlay: (role) => {
        rolePreference = role
        startGame()
      },
      onSignOut: async () => {
        await auth.signOut()
        void showMenu()
      },
    })
  }

  const startGame = () => {
    audio.unlock() // runs inside the "Find match" click, which browsers require for audio
    ui.hidden = true
    const socket = new GameSocket(() => gameSocketUrl(auth.accessToken()))
    const game = new ClientGame(socket, keyboard, rolePreference, roomFromUrl())
    effects.attach(game)
    audio.attach(game)
    renderer.attach(game)
    socket.connect()
    session = { socket, game }
    keyboard.setEnabled(true)
  }

  const leaveGame = () => {
    keyboard.setEnabled(false)
    session?.socket.close()
    session = null
    void showMenu()
  }

  const resize = () => {
    grid.resize(window.innerWidth, window.innerHeight)
    renderer.resize(window.innerWidth, window.innerHeight, worldFontPx, FONT_FAMILY)
  }
  const zoom = (step: number) => {
    worldFontPx = Math.min(MAX_WORLD_FONT_PX, Math.max(MIN_WORLD_FONT_PX, worldFontPx + step))
    storeWorldFont(worldFontPx)
    resize()
  }
  window.addEventListener('resize', resize)
  resize()

  let previousTime = performance.now()
  // Render every frame: interpolation, gliding and effects change the picture even without new snapshots.
  const frame = (now: number) => {
    const presses = keyboard.consumePresses()
    if (session && presses.has(LEAVE_KEY)) leaveGame()
    if (session) {
      if (presses.has(DEBUG_TOGGLE_KEY)) debugOverlay.visible = !debugOverlay.visible
      if (presses.has(BOT_DEBUG_TOGGLE_KEY)) renderer.showBotDebug = !renderer.showBotDebug
      if (presses.has(CRT_TOGGLE_KEY)) document.body.classList.toggle(CRT_CLASS)
      if (presses.has(MUTE_KEY)) audio.toggleMute()
      if (presses.has(ZOOM_OUT_KEY)) zoom(-1)
      if (presses.has(ZOOM_IN_KEY)) zoom(1)
      session.game.queuePresses(presses)
      session.game.update(now - previousTime, now)
      audio.update(session.game, now)
      renderer.render(session.game, session.socket, now)
      debugOverlay.render(session.game, session.socket, now)
    }
    previousTime = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
  await showMenu()
}

start().catch((error: unknown) => {
  console.error(error)
  document.body.textContent = `Failed to start: ${errorText(error)}`
})
