import type { ClientGame, RenderEntity } from '../game/clientGame'
import { computeLighting, type LightSource } from '../game/lighting'
import { GameRules } from '../game/rules'
import type { TileMap } from '../game/tileMap'
import { Palette } from '../game/tiles'
import type { EntityView, GeneratorView, SnapshotPayload } from '../net/protocol'
import type { GameSocket } from '../net/socket'
import { Animator } from './animator'
import type { AsciiGrid } from './asciiGrid'
import { viewportOrigin } from './camera'
import { lit, mix, scale } from './color'
import type { Effects } from './effects'
import { HUD_BOTTOM_ROWS, HUD_TOP_ROWS, renderHud } from './hud'
import { renderOverlays } from './overlays'
import { spriteFrame, type MaskKey } from './sprites/sprites'
import { TILE_H, TILE_W, VOID, tileCellArt, type TileArtState } from './tileArt'

const SURVIVOR_TINT = '#ffcf87'
const MONSTER_TINT = '#ff5a4a'
/** Brightness factor for map cells that are not lit now: never seen / seen before. */
const AMBIENT_UNSEEN = 0.3
const AMBIENT_REMEMBERED = 0.55
const GLYPH_LIGHT_GAIN = 2.2
const BLOCK_LIGHT_GAIN = 0.9
/** Lit cells get a faint background wash in the light's colour, so light reads even on empty floor. */
const LIGHT_WASH = 0.1
const MIN_WASH_BRIGHTNESS = 0.04
const GENERATOR_LIGHT_RADIUS = 3
const GATE_LIGHT_RADIUS = 3
/** Entities the server lets us see but that stand in darkness (teammate aura, sonar) are drawn dimmer. */
const ENTITY_MIN_BRIGHTNESS = 0.55
const BLINK_MS = 400
const INJURED_COLOR = '#e74c3c'
const DOWNED_FACTOR = 0.6
const TRAP_ART = '/^\\'
const TRAP_COLOR = '#e74c3c'
const TRAIL_COLOR = '#8e1b10'
const SOUND_RING_TILES = 4
const SONAR_COLOR = '#c0392b'
const BOT_DEBUG_COLOR = '#d35dff'
const NAME_COLOR = '#8a8a96'
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
const SKIN = '#f1d3b3'
const MASK_COLORS: Record<Exclude<MaskKey, 'b' | 'd' | 'h' | 'e'>, string> = {
  w: '#efe6d0',
  r: '#e74c3c',
  y: '#ffd24a',
  k: '#1a1a1a',
}
const MONSTER_EYES = '#ffe14a'
const SURVIVOR_EYES = '#ffffff'

/** An entity with its fractional render position (own predicted character or an interpolated one). */
type Positioned = EntityView & { readonly renderX: number; readonly renderY: number }

interface LightingCache {
  key: string
  brightness: Float32Array
}

/** World (cell) coordinates → screen grid cells for the current frame. */
interface View {
  readonly originX: number
  readonly originY: number
  column(worldCellX: number): number
  row(worldCellY: number): number
}

/**
 * Draws the world in "rich ASCII": each map tile is a TILE_W × TILE_H block of textured cells, characters are
 * animated multi-cell sprites, and light is interpolated per cell. The camera follows the player smoothly and
 * the view fills the whole screen.
 */
export class SceneRenderer {
  /** Dev aid (F4): draw bot paths and states when the server sends them. */
  showBotDebug = false
  private readonly grid: AsciiGrid
  private readonly effects: Effects
  private readonly animator = new Animator()
  private lightingCache: LightingCache | null = null
  /** Tiles the local player has seen lit (drawn a little brighter than unexplored ones). */
  private seen: Uint8Array | null = null
  private seenMap: TileMap | null = null
  private lastOwnAttackCooldown = 0

  constructor(grid: AsciiGrid, effects: Effects) {
    this.grid = grid
    this.effects = effects
  }

  /** Subscribes to match events that drive animations (the monster's swipe). */
  attach(game: ClientGame): void {
    game.onGameEvent((event) => {
      if (event.kind === 'hit') this.animator.markAttack(Number(event.data.attackerId), performance.now())
    })
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
    const focusX = Math.round(self.renderX * TILE_W + TILE_W / 2)
    const focusY = Math.round(self.renderY * TILE_H + TILE_H / 2)
    const originX = viewportOrigin(focusX, map.width * TILE_W, this.grid.columns) + shake.dx
    const originY = viewportOrigin(focusY, map.height * TILE_H, viewRows) + shake.dy
    const view: View = {
      originX,
      originY,
      column: (x) => x - originX,
      row: (y) => y - originY + HUD_TOP_ROWS,
    }

    const brightness = this.lighting(game, map, snapshot, self)
    this.rememberSeen(map, brightness)
    this.drawTiles(game, map, snapshot, brightness, view, viewRows, now)
    this.drawTrailsAndTraps(snapshot, view)
    this.trackOwnAttack(snapshot, now)

    const others = game.others(now)
    this.animator.forget(new Set([...others.map((e) => e.id), self.id]))
    // Back to front: sprites lower on screen overlap the ones behind them.
    const drawOrder = [...others, ...(snapshot.you.hidden ? [] : [self])].sort((a, b) => a.renderY - b.renderY)
    for (const entity of drawOrder) {
      this.drawEntity(entity, map, brightness, view, now, entity === self)
      if (entity.activity === 'repair') this.effects.sparkle(entity.x, entity.y, now)
    }
    if (snapshot.you.role === 'survivor') this.drawTeammateNames(others, view)
    this.drawSounds(snapshot, self, view)
    if (this.showBotDebug) this.drawBotDebug(snapshot, view)
    this.drawEffects(view, self, now)
    this.drawScreenTint(snapshot, now)
  }

  // ------------------------------------------------------------------ lighting

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

  /** Light at a world cell, bilinearly interpolated between tile centres so it fades smoothly. */
  private sampleLight(map: TileMap, brightness: Float32Array, cellX: number, cellY: number): number {
    const fx = (cellX + 0.5) / TILE_W - 0.5
    const fy = (cellY + 0.5) / TILE_H - 0.5
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const at = (x: number, y: number) => (map.isInside(x, y) ? brightness[y * map.width + x] : 0)
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
    return top * (1 - ty) + bottom * ty
  }

  // ------------------------------------------------------------------ world

  private drawTiles(
    game: ClientGame,
    map: TileMap,
    snapshot: SnapshotPayload,
    brightness: Float32Array,
    view: View,
    viewRows: number,
    now: number,
  ): void {
    const tint = snapshot.you.role === 'monster' ? MONSTER_TINT : SURVIVOR_TINT
    const generators = new Map<number, GeneratorView>()
    for (const generator of snapshot.generators) generators.set(generator.y * map.width + generator.x, generator)
    const state: TileArtState = { generators, gateOpen: game.match?.gateOpen ?? false, nowMs: now }
    const seen = this.seen!
    const mapCellsX = map.width * TILE_W
    const mapCellsY = map.height * TILE_H

    for (let row = 0; row < viewRows; row++) {
      const cellY = view.originY + row
      if (cellY < 0 || cellY >= mapCellsY) continue
      const tileY = Math.floor(cellY / TILE_H)
      for (let column = 0; column < this.grid.columns; column++) {
        const cellX = view.originX + column
        if (cellX < 0 || cellX >= mapCellsX) continue
        const tileX = Math.floor(cellX / TILE_W)
        const art = tileCellArt(map, tileX, tileY, cellX - tileX * TILE_W, cellY - tileY * TILE_H, state)
        const light = this.sampleLight(map, brightness, cellX, cellY)
        const screenRow = row + HUD_TOP_ROWS
        if (art === VOID) continue
        if (light > MIN_WASH_BRIGHTNESS) {
          this.grid.fillCells(column, screenRow, 1, 1, scale(tint, light * LIGHT_WASH))
        }
        if (art.glyph === null || art.glyph === ' ') continue
        const ambient = seen[tileY * map.width + tileX] ? AMBIENT_REMEMBERED : AMBIENT_UNSEEN
        const gain = art.solid ? BLOCK_LIGHT_GAIN : GLYPH_LIGHT_GAIN
        this.grid.drawGlyph(column, screenRow, art.glyph, lit(art.color, tint, light, ambient, gain))
      }
    }
  }

  private drawTrailsAndTraps(snapshot: SnapshotPayload, view: View): void {
    for (const trail of snapshot.trails) {
      const color = scale(TRAIL_COLOR, 1.5 - trail.age)
      const x = trail.x * TILE_W
      const y = trail.y * TILE_H + TILE_H - 1
      this.grid.drawGlyph(view.column(x + 1), view.row(y), ',', color)
      this.grid.drawGlyph(view.column(x + 3), view.row(y - 1), '.', color)
    }
    for (const trap of snapshot.traps) {
      const x = trap.x * TILE_W + 1
      const y = trap.y * TILE_H + TILE_H - 1
      this.grid.drawText(view.column(x), view.row(y), TRAP_ART, TRAP_COLOR)
    }
  }

  // ------------------------------------------------------------------ characters

  /** Our own swing: the attack cooldown jumping up means we just attacked. */
  private trackOwnAttack(snapshot: SnapshotPayload, now: number): void {
    const cooldown = snapshot.you.cooldowns.attackMs
    if (snapshot.you.role === 'monster' && cooldown > this.lastOwnAttackCooldown) {
      this.animator.markAttack(snapshot.you.id, now)
    }
    this.lastOwnAttackCooldown = cooldown
  }

  private drawEntity(
    entity: Positioned,
    map: TileMap,
    brightness: Float32Array,
    view: View,
    now: number,
    isSelf: boolean,
  ): void {
    const { animation, frame, facing } = this.animator.frame(entity, now)
    const sprite = spriteFrame(animation, frame, facing)
    const feetX = Math.round(entity.renderX * TILE_W + Math.floor(TILE_W / 2))
    const feetY = Math.round(entity.renderY * TILE_H + TILE_H - 1)
    const light = isSelf ? 1 : Math.max(ENTITY_MIN_BRIGHTNESS, this.sampleLight(map, brightness, feetX, feetY))
    const body = this.bodyColor(entity, now)
    for (const cell of sprite.cells) {
      const color = scale(this.maskColor(cell.mask, body, entity.kind), light)
      this.grid.drawGlyph(view.column(feetX + cell.dx), view.row(feetY + cell.dy), cell.glyph, color)
    }
  }

  private bodyColor(entity: EntityView, now: number): string {
    if (entity.health === 'downed') return scale(entity.color, DOWNED_FACTOR)
    if (entity.health === 'injured' && Math.floor(now / BLINK_MS) % 2 === 0) return mix(entity.color, INJURED_COLOR, 0.7)
    return entity.color
  }

  private maskColor(mask: MaskKey, body: string, kind: EntityView['kind']): string {
    switch (mask) {
      case 'b':
        return body
      case 'd':
        return scale(body, 0.62)
      case 'h':
        return kind === 'survivor' ? mix(body, SKIN, 0.55) : scale(body, 0.8)
      case 'e':
        return kind === 'monster' ? MONSTER_EYES : SURVIVOR_EYES
      default:
        return MASK_COLORS[mask]
    }
  }

  private drawTeammateNames(others: readonly Positioned[], view: View): void {
    for (const entity of others) {
      if (entity.kind !== 'survivor') continue
      const label = entity.name.replace(' (bot)', '')
      const x = Math.round(entity.renderX * TILE_W + TILE_W / 2) - Math.floor(label.length / 2)
      const y = Math.round(entity.renderY * TILE_H) - 1
      this.grid.drawText(view.column(x), view.row(y), label, NAME_COLOR)
    }
  }

  // ------------------------------------------------------------------ overlays in the world

  /** The monster hears noises as arcs around itself, pointing towards the source: `)))`. */
  private drawSounds(snapshot: SnapshotPayload, self: RenderEntity, view: View): void {
    const centerX = self.renderX * TILE_W + TILE_W / 2
    const centerY = self.renderY * TILE_H + TILE_H / 2
    for (const sound of snapshot.sounds) {
      const color = scale(SOUND_COLORS[sound.kind] ?? '#ffffff', 0.4 + sound.intensity * 0.6)
      const horizontal = Math.abs(sound.dx) >= Math.abs(sound.dy)
      const glyph = horizontal ? (sound.dx > 0 ? ')' : '(') : sound.dy > 0 ? 'v' : '^'
      const arcs = Math.max(1, Math.round(sound.intensity * 3))
      for (let arc = 0; arc < arcs; arc++) {
        const distance = SOUND_RING_TILES + arc * 0.6
        const x = Math.round(centerX + sound.dx * distance * TILE_W)
        const y = Math.round(centerY + sound.dy * distance * TILE_H)
        // Each arc is three glyphs wide, perpendicular to the direction, like `)` stacked.
        for (let spread = -1; spread <= 1; spread++) {
          this.grid.drawGlyph(view.column(x + (horizontal ? 0 : spread)), view.row(y + (horizontal ? spread : 0)), glyph, color)
        }
      }
    }
  }

  private drawBotDebug(snapshot: SnapshotPayload, view: View): void {
    for (const bot of snapshot.bots ?? []) {
      bot.path.forEach((cell, index) => {
        if (index === 0) return
        this.grid.drawGlyph(view.column(cell.x * TILE_W + 2), view.row(cell.y * TILE_H + 1), '∙', BOT_DEBUG_COLOR)
      })
      const head = bot.path[0]
      if (head) {
        this.grid.drawText(view.column(head.x * TILE_W + 3), view.row(head.y * TILE_H - 2), `#${bot.id} ${bot.state}`, BOT_DEBUG_COLOR)
      }
    }
  }

  private drawEffects(view: View, self: RenderEntity, now: number): void {
    for (const particle of this.effects.particles) {
      const { x, y, life } = this.effects.particlePosition(particle, now)
      const column = view.column(Math.round(x * TILE_W + TILE_W / 2))
      const row = view.row(Math.round(y * TILE_H + TILE_H / 2))
      this.grid.drawGlyph(column, row, particle.glyph, scale(particle.color, 0.4 + 0.6 * life))
    }
    const sonar = this.effects.sonarRadius(now, GameRules.monster.sonarRadius)
    if (sonar === null) return
    const origin = this.effects.sonarOrigin ?? { x: self.x, y: self.y }
    const points = Math.ceil(sonar * 14)
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2
      const x = Math.round((origin.x + 0.5 + Math.cos(angle) * sonar) * TILE_W)
      const y = Math.round((origin.y + 0.5 + Math.sin(angle) * sonar) * TILE_H)
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
