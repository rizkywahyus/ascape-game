import type { ClientGame, RenderEntity } from '../game/clientGame'
import { computeLighting, type LightSource } from '../game/lighting'
import { GameRules } from '../game/rules'
import type { TileMap } from '../game/tileMap'
import { Palette } from '../game/tiles'
import type { GeneratorView, Health, SnapshotPayload } from '../net/protocol'
import type { GameSocket } from '../net/socket'
import type { AsciiGrid } from './asciiGrid'
import { viewportOrigin } from './camera'
import { lit, mix, scale } from './color'
import type { Effects } from './effects'
import { HUD_BOTTOM_ROWS, HUD_TOP_ROWS, renderHud } from './hud'
import { renderOverlays } from './overlays'

const SURVIVOR_TINT = '#ffcf87'
const MONSTER_TINT = '#ff5a4a'
/** Brightness factor for map cells that are not lit now: never seen / seen before. */
const AMBIENT_UNSEEN = 0.35
const AMBIENT_REMEMBERED = 0.6
const GENERATOR_LIGHT_RADIUS = 3
const GATE_LIGHT_RADIUS = 3
const GENERATOR_DONE_GLYPH = '■'
const GENERATOR_DONE_COLOR = '#58d68d'
const GENERATOR_IDLE_COLOR = '#e0b030'
const GATE_OPEN_GLYPHS = ['░', '▒']
const TRAP_GLYPH = '^'
const TRAP_COLOR = '#e74c3c'
const TRAIL_GLYPH = '.'
const TRAIL_COLOR = '#8e1b10'
const DOWNED_COLOR = '#7b241c'
const INJURED_COLOR = '#e74c3c'
const BLINK_MS = 400
const GLYPH_LIGHT_GAIN = 2.4
const BLOCK_LIGHT_GAIN = 0.7
const BLOCK_GLYPH = '█'
const SOUND_RING_RADIUS = 5
const SONAR_COLOR = '#c0392b'
const BOT_DEBUG_COLOR = '#d35dff'
const SOUND_COLORS: Record<string, string> = {
  footsteps: '#f5f0e0',
  repair: '#f0c040',
  locker: '#b07a45',
  rock: '#aab0b8',
  trap: '#e74c3c',
  scream: '#ff6b5b',
  generator: '#58d68d',
  explosion: '#ff9f43',
}

interface Drawable {
  readonly glyph: string
  readonly color: string
  readonly health: Health
}

interface LightingCache {
  key: string
  brightness: Float32Array
}

/** Converts map coordinates to grid cells for the current frame. */
interface View {
  column(x: number): number
  row(y: number): number
}

/** Draws the map, lighting, entities and effects for one frame, then the HUD and overlays. */
export class SceneRenderer {
  /** Dev aid (F4): draw bot paths and states when the server sends them. */
  showBotDebug = false
  private readonly grid: AsciiGrid
  private readonly effects: Effects
  private lightingCache: LightingCache | null = null
  /** Cells the local player has seen lit (drawn a little brighter than unexplored ones). */
  private seen: Uint8Array | null = null
  private seenMap: TileMap | null = null

  constructor(grid: AsciiGrid, effects: Effects) {
    this.grid = grid
    this.effects = effects
  }

  render(game: ClientGame, socket: GameSocket, now: number): void {
    this.grid.clear(Palette.background)
    this.effects.update(now)
    const map = game.map
    const snapshot = game.latest
    const self = game.self(now)
    if (map && snapshot && self && game.phase === 'playing') this.renderWorld(game, map, snapshot, self, now)
    renderHud(this.grid, game, socket, now)
    renderOverlays(this.grid, game, now)
  }

  private renderWorld(game: ClientGame, map: TileMap, snapshot: SnapshotPayload, self: RenderEntity, now: number): void {
    const viewRows = Math.max(this.grid.rows - HUD_TOP_ROWS - HUD_BOTTOM_ROWS, 0)
    const shake = this.effects.shakeOffset(now)
    const originX = viewportOrigin(Math.round(self.renderX), map.width, this.grid.columns) + shake.dx
    const originY = viewportOrigin(Math.round(self.renderY), map.height, viewRows) + shake.dy
    const view: View = { column: (x) => x - originX, row: (y) => y - originY + HUD_TOP_ROWS }

    const brightness = this.lighting(game, map, snapshot, self)
    this.rememberSeen(map, brightness)
    this.drawTiles(game, map, snapshot, brightness, originX, originY, viewRows, now)

    for (const trail of snapshot.trails) {
      this.grid.drawGlyph(view.column(trail.x), view.row(trail.y), TRAIL_GLYPH, scale(TRAIL_COLOR, 1.4 - trail.age))
    }
    for (const trap of snapshot.traps) this.grid.drawGlyph(view.column(trap.x), view.row(trap.y), TRAP_GLYPH, TRAP_COLOR)
    for (const entity of game.others(now)) {
      this.drawEntity(entity, view.column(entity.renderX), view.row(entity.renderY), now)
      if (entity.activity === 'repair') this.effects.sparkle(entity.x, entity.y, now)
    }
    if (!snapshot.you.hidden) this.drawEntity(self, view.column(self.renderX), view.row(self.renderY), now)
    if (snapshot.you.activity === 'repair') this.effects.sparkle(self.x, self.y, now)
    this.drawSounds(snapshot, self, view)
    if (this.showBotDebug) this.drawBotDebug(snapshot, view)
    this.drawEffects(view, self, now)
    this.drawScreenTint(snapshot, now)
  }

  private lighting(game: ClientGame, map: TileMap, snapshot: SnapshotPayload, self: RenderEntity): Float32Array {
    const you = snapshot.you
    const viewer = { x: self.x, y: self.y }
    const lights: LightSource[] = [
      {
        position: viewer,
        radius: you.role === 'monster' ? GameRules.monster.visionRadius : lightRadius(you.flashlight),
      },
    ]
    for (const entity of snapshot.entities) {
      if (entity.id !== you.id && entity.kind === 'survivor' && entity.flashlight) {
        lights.push({ position: { x: entity.x, y: entity.y }, radius: lightRadius(true) })
      }
    }
    for (const generator of snapshot.generators) {
      if (generator.done) lights.push({ position: generator, radius: GENERATOR_LIGHT_RADIUS })
    }
    if (game.match?.gateOpen) {
      for (const gate of map.findAll('gate')) lights.push({ position: gate, radius: GATE_LIGHT_RADIUS })
    }
    const key = lights.map((l) => `${l.position.x},${l.position.y},${l.radius}`).join(';')
    if (this.lightingCache?.key !== key) {
      this.lightingCache = { key, brightness: computeLighting(map, viewer, lights) }
    }
    return this.lightingCache.brightness
  }

  private rememberSeen(map: TileMap, brightness: Float32Array): void {
    if (this.seenMap !== map || !this.seen) {
      this.seen = new Uint8Array(map.width * map.height)
      this.seenMap = map
    }
    for (let i = 0; i < brightness.length; i++) if (brightness[i] > 0) this.seen[i] = 1
  }

  private drawTiles(
    game: ClientGame,
    map: TileMap,
    snapshot: SnapshotPayload,
    brightness: Float32Array,
    originX: number,
    originY: number,
    viewRows: number,
    now: number,
  ): void {
    const tint = snapshot.you.role === 'monster' ? MONSTER_TINT : SURVIVOR_TINT
    const generatorsByCell = new Map<number, GeneratorView>()
    for (const generator of snapshot.generators) generatorsByCell.set(generator.y * map.width + generator.x, generator)
    const gateOpen = game.match?.gateOpen ?? false
    const seen = this.seen!

    for (let row = 0; row < viewRows; row++) {
      for (let column = 0; column < this.grid.columns; column++) {
        const x = originX + column
        const y = originY + row
        if (!map.isInside(x, y)) continue
        const index = y * map.width + x
        const tile = map.tileAt(x, y)
        let glyph = tile.glyph
        let color = tile.color
        if (tile.kind === 'generator') {
          const generator = generatorsByCell.get(index)
          if (generator?.done) {
            glyph = GENERATOR_DONE_GLYPH
            color = GENERATOR_DONE_COLOR
          } else if (generator?.progress != null) {
            color = mix(GENERATOR_IDLE_COLOR, GENERATOR_DONE_COLOR, generator.progress)
          }
        } else if (tile.kind === 'gate' && gateOpen) {
          glyph = GATE_OPEN_GLYPHS[Math.floor(now / BLINK_MS) % GATE_OPEN_GLYPHS.length]
          color = '#ffffff'
        }
        const ambient = seen[index] ? AMBIENT_REMEMBERED : AMBIENT_UNSEEN
        const gain = glyph === BLOCK_GLYPH ? BLOCK_LIGHT_GAIN : GLYPH_LIGHT_GAIN
        this.grid.drawGlyph(column, row + HUD_TOP_ROWS, glyph, lit(color, tint, brightness[index], ambient, gain))
      }
    }
  }

  private drawEntity(entity: Drawable, column: number, row: number, now: number): void {
    let color = entity.color
    if (entity.health === 'injured' && Math.floor(now / BLINK_MS) % 2 === 0) color = INJURED_COLOR
    if (entity.health === 'downed') color = DOWNED_COLOR
    this.grid.drawGlyph(column, row, entity.glyph, color)
  }

  /** The monster hears noises as arcs around itself, pointing towards the source: `)))`. */
  private drawSounds(snapshot: SnapshotPayload, self: RenderEntity, view: View): void {
    for (const sound of snapshot.sounds) {
      const color = scale(SOUND_COLORS[sound.kind] ?? '#ffffff', 0.4 + sound.intensity * 0.6)
      const horizontal = Math.abs(sound.dx) >= Math.abs(sound.dy)
      const glyph = horizontal ? (sound.dx > 0 ? ')' : '(') : sound.dy > 0 ? 'v' : '^'
      const arcs = Math.max(1, Math.round(sound.intensity * 3))
      for (let arc = 0; arc < arcs; arc++) {
        const distance = SOUND_RING_RADIUS + arc
        const x = Math.round(self.renderX + sound.dx * distance)
        const y = Math.round(self.renderY + sound.dy * distance * 0.6)
        this.grid.drawGlyph(view.column(x), view.row(y), glyph, color)
      }
    }
  }

  private drawBotDebug(snapshot: SnapshotPayload, view: View): void {
    for (const bot of snapshot.bots ?? []) {
      bot.path.forEach((cell, index) => {
        if (index > 0) this.grid.drawGlyph(view.column(cell.x), view.row(cell.y), '∙', BOT_DEBUG_COLOR)
      })
      const head = bot.path[0]
      if (head) this.grid.drawText(view.column(head.x) + 1, view.row(head.y) - 1, `#${bot.id} ${bot.state}`, BOT_DEBUG_COLOR)
    }
  }

  private drawEffects(view: View, self: RenderEntity, now: number): void {
    for (const particle of this.effects.particles) {
      const { x, y, life } = this.effects.particlePosition(particle, now)
      this.grid.drawGlyph(view.column(x), view.row(y), particle.glyph, scale(particle.color, 0.4 + 0.6 * life))
    }
    const sonar = this.effects.sonarRadius(now, GameRules.monster.sonarRadius)
    if (sonar === null) return
    const origin = this.effects.sonarOrigin ?? { x: self.x, y: self.y }
    const points = Math.ceil(sonar * 6)
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2
      const x = Math.round(origin.x + Math.cos(angle) * sonar)
      const y = Math.round(origin.y + Math.sin(angle) * sonar * 0.6)
      this.grid.drawGlyph(view.column(x), view.row(y), '·', SONAR_COLOR)
    }
  }

  /** Hit flash and the survivor heartbeat vignette. */
  private drawScreenTint(snapshot: SnapshotPayload, now: number): void {
    const flash = this.effects.flashAlpha(now)
    if (flash > 0) this.grid.tint(this.effects.flashColor, flash)
    const terror = snapshot.you.terror
    if (terror > 0 && snapshot.you.role === 'survivor') {
      const beatsPerSecond = 1 + terror * 1.8
      const pulse = Math.pow(Math.max(0, Math.sin((now / 1000) * Math.PI * beatsPerSecond)), 8)
      this.grid.vignette('#8b0000', terror * (0.3 + 0.4 * pulse))
    }
  }
}

function lightRadius(flashlightOn: boolean): number {
  return flashlightOn ? GameRules.survivor.flashlightRadius : GameRules.survivor.darkRadius
}
