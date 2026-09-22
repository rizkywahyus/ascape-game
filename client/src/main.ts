import { AudioEngine } from './audio/audio'
import { Auth } from './auth/auth'
import { ClientGame } from './game/clientGame'
import { KeyboardInput } from './input/keyboard'
import type { RolePreference } from './net/protocol'
import { gameSocketUrl } from './net/serverUrl'
import { GameSocket } from './net/socket'
import { AsciiGrid, LINE_HEIGHT_RATIO } from './render/asciiGrid'
import { DebugOverlay } from './render/debugOverlay'
import { Effects } from './render/effects'
import { HUD_BOTTOM_ROWS, HUD_TOP_ROWS } from './render/hud'
import { SceneRenderer } from './render/sceneRenderer'
import { TILE_H } from './render/tileArt'
import { Api } from './ui/api'
import { errorText, showAuthScreen } from './ui/authScreen'
import { showLobbyScreen } from './ui/lobbyScreen'
import './ui/styles.css'

const FONT_FAMILY = '"JetBrains Mono", ui-monospace, monospace'
const FONT_LOAD_SPEC = '16px "JetBrains Mono"'
/** Roughly this many map tiles fit the screen height; the font scales to match, so any screen is filled. */
const VIEW_TILES_TALL = 17
const MIN_FONT_PX = 8
const MAX_FONT_PX = 22
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

function fontSizeFor(viewportHeight: number): number {
  const rows = VIEW_TILES_TALL * TILE_H + HUD_TOP_ROWS + HUD_BOTTOM_ROWS
  const size = Math.floor(viewportHeight / rows / LINE_HEIGHT_RATIO)
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, size))
}

function enterFullscreen(): void {
  if (document.fullscreenElement || !document.documentElement.requestFullscreen) return
  document.documentElement.requestFullscreen().catch((error: unknown) => {
    // Not fatal: some browsers (iOS Safari) or embedded frames refuse; the canvas still fills the window.
    console.info('Fullscreen unavailable', error)
  })
}

/** `?room=<id>` joins a specific (private) room instead of matchmaking. */
function roomFromUrl(): string | null {
  return new URLSearchParams(location.search).get('room')
}

async function start(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#screen')
  const ui = document.querySelector<HTMLElement>('#ui')
  if (!canvas || !ui) throw new Error('#screen or #ui missing from index.html')

  await loadFont()

  const auth = new Auth()
  const api = new Api(() => auth.accessToken())
  const keyboard = new KeyboardInput(window)
  const grid = new AsciiGrid(canvas, FONT_FAMILY, fontSizeFor(window.innerHeight))
  const effects = new Effects()
  const renderer = new SceneRenderer(grid, effects)
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
    // Both run inside the "Find match" click: browsers only allow audio and fullscreen from a user gesture.
    audio.unlock()
    enterFullscreen()
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
    grid.setFontSize(fontSizeFor(window.innerHeight))
    grid.resize(window.innerWidth, window.innerHeight)
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
