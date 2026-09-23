import type { ClientGame } from '../game/clientGame'
import { computeLighting, type LightSource } from '../game/lighting'
import { GameRules } from '../game/rules'
import type { TileMap } from '../game/tileMap'
import { Actions, type EntityView, type SnapshotPayload } from '../net/protocol'
import type { GameSocket } from '../net/socket'
import { Animator, type Facing } from './animator'
import type { AsciiGrid } from './asciiGrid'
import { viewportOrigin } from './camera'
import { parseHex } from './color'
import type { Effects } from './effects'
import { FEED_MAX_ROWS, feedFirstRow, HUD_BOTTOM_ROWS, HUD_TOP_ROWS, renderHud } from './hud'
import { renderOverlays } from './overlays'
import { AttractScene, type SceneArea, type SceneLabel } from './attract/attractScene'
import { AsciiShader } from './world/asciiShader'
import { drawMonster, drawSurvivor, RIG_SCALE, withRigTransform } from './world/rig'
import { fill, LightMap, paintGenerators, paintOpenGate, renderMapBase, TILE_H, TILE_W } from './world/worldPainter'

/** Light colour multiplied over the scene: warm flashlight for survivors, red dark-vision for the monster. */
const SURVIVOR_TINT = [1.0, 0.9, 0.74] as const
const MONSTER_TINT = [1.0, 0.5, 0.45] as const
/** Brightness of map areas that are not lit now: never seen / seen before. */
const AMBIENT_UNSEEN = 0.05
const AMBIENT_REMEMBERED = 0.13
/** Lights brighter than this are clipped by the multiply pass, so the base art is authored as "fully lit". */
const LIGHT_BOOST = 1.25
const GENERATOR_LIGHT_RADIUS = 3
const GATE_LIGHT_RADIUS = 3
/** The survivors' way-out marker: dim while the gate is locked, lit once it opens. */
const GATE_LOCKED_COLOR = '#8a7a50'
const GATE_OPEN_COLOR = '#ffffff'
const MARKER_PANEL = 'rgba(7, 7, 10, 0.7)'
/** Survivors revealed by a sonar sweep. */
const SONAR_PING_COLOR = '#e74c3c'
/** How hard the screen shakes and reddens while a monster hauls this survivor away. */
const TAKEN_SHAKE_MS = 120
const TAKEN_TINT_ALPHA = 0.5
/** Entities the server lets us see but that stand in darkness (teammate aura, sonar) are drawn dimmer. */
const ENTITY_MIN_BRIGHTNESS = 0.5
const BLINK_MS = 400
const INJURED_COLOR = '#e74c3c'
const TRAIL_RGB = [150, 20, 12] as const
const TRAP_RGB = [230, 60, 45] as const
const SOUND_RING_TILES = 3
const SONAR_RGB = [220, 40, 30] as const
const NAME_COLOR = '#9a9aa6'
const BOT_DEBUG_COLOR = '#d35dff'
const SOUND_COLORS: Record<string, string> = {
  footsteps: '#f5f0e0',
  repair: '#f0c040',
  locker: '#d08a45',
  rock: '#c8ccd2',
  trap: '#ff5040',
  scream: '#ff6b5b',
  generator: '#70ff90',
  explosion: '#ffa050',
}

type Positioned = EntityView & { readonly renderX: number; readonly renderY: number }

interface LightingCache {
  key: string
  brightness: Float32Array
}

/** World pixels → scene pixels for the current frame (1 scene pixel = 1 character cell on screen). */
interface View {
  readonly originX: number
  readonly originY: number
}

/**
 * Draws the world as an image-to-ASCII picture: the scene is painted as small pixel art (1 pixel per character
 * cell), lit, and turned into characters on the GPU by {@link AsciiShader}. The HUD, overlays and labels are drawn
 * as crisp text on a separate layer above it.
 */
export class SceneRenderer {
  /** Dev aid (F4): draw bot paths and states when the server sends them. */
  showBotDebug = false
  private edgeMarkers: EdgeMarker[] = []
  /** On-screen touch controls are shown, so the HUD drops its keyboard help line. */
  touchUi = false
  private readonly hud: AsciiGrid
  private readonly effects: Effects
  private readonly shader: AsciiShader | null
  private readonly scene = document.createElement('canvas')
  private readonly sceneContext: CanvasRenderingContext2D
  private readonly lightMap = new LightMap()
  private readonly animator = new Animator()
  private mapBase: { map: TileMap; canvas: HTMLCanvasElement } | null = null
  private lightingCache: LightingCache | null = null
  private seen: Uint8Array | null = null
  private seenMap: TileMap | null = null
  private lastOwnAttackCooldown = 0
  private attract: AttractScene | null = null

  constructor(hud: AsciiGrid, effects: Effects, worldCanvas: HTMLCanvasElement) {
    this.hud = hud
    this.effects = effects
    this.sceneContext = this.scene.getContext('2d')!
    this.shader = createShader(worldCanvas)
  }

  /** Subscribes to match events that drive animations (the monster's swipe). */
  attach(game: ClientGame): void {
    game.onGameEvent((event) => {
      if (event.kind === 'hit') this.animator.markAttack(Number(event.data.attackerId), performance.now())
    })
    // Swing immediately on the key press instead of a round trip later.
    game.onLocalAction((action, current) => {
      const now = performance.now()
      const you = current.latest?.you
      if (action !== Actions.attack || !you || !current.attackReady(now)) return
      this.animator.markAttack(you.id, now)
      const self = current.self(now)
      if (self) this.effects.slash(self.renderX, self.renderY, this.animator.facing(you.id), now)
    })
  }

  /** Resizes the world layer; `worldFontCss` sets how small (and so how many) the ASCII characters are. */
  resize(widthCss: number, heightCss: number, worldFontCss: number, fontFamily: string): void {
    if (!this.shader) return
    const grid = this.shader.resize(widthCss, heightCss, worldFontCss, fontFamily)
    this.scene.width = grid.columns
    this.scene.height = grid.rows
  }

  /**
   * Menu background: the scripted attract-mode scene instead of a live match. `stageCss` (a box on the page, in
   * CSS pixels) confines it to that box, for small screens where the menu covers the whole page.
   */
  renderAttract(now: number, stageCss: DOMRect | null = null): void {
    this.hud.clear(null)
    const context = this.sceneContext
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.fillStyle = '#000'
    context.fillRect(0, 0, this.scene.width, this.scene.height)
    if (!this.shader) return
    this.attract ??= new AttractScene()
    const stage = stageCss && this.sceneArea(stageCss)
    const labels = this.attract.paint(context, this.scene.width, this.scene.height, this.cellAspect(), now, stage)
    this.shader.draw(this.scene)
    this.drawAttractLabels(labels, stage)
  }

  /** Captions over the attract scene, kept inside the stage and skipped where they would overlap another. */
  private drawAttractLabels(labels: readonly SceneLabel[], stage: SceneArea | null): void {
    const first = stage ? this.hudCell(stage.x, stage.y).column : 0
    const last = stage ? this.hudCell(stage.x + stage.width, stage.y).column - 1 : this.hud.columns - 1
    const drawn: { row: number; from: number; to: number }[] = []
    for (const label of labels) {
      const { column, row } = this.hudCell(label.sceneX, label.sceneY)
      const from = Math.max(first, Math.min(column - Math.floor(label.text.length / 2), last - label.text.length + 1))
      const to = from + label.text.length - 1
      if (drawn.some((other) => other.row === row && other.from <= to && from <= other.to)) continue
      drawn.push({ row, from, to })
      this.hud.drawText(from, row, label.text, label.color)
    }
  }

  render(game: ClientGame, socket: GameSocket, now: number): void {
    this.hud.clear(null)
    this.effects.update(now)
    const context = this.sceneContext
    context.globalCompositeOperation = 'source-over'
    context.globalAlpha = 1
    context.fillStyle = '#000'
    context.fillRect(0, 0, this.scene.width, this.scene.height)
    const map = game.map
    const snapshot = game.latest
    const self = game.self(now)
    if (map && snapshot && self && game.phase === 'playing') this.paintWorld(game, map, snapshot, self, now)
    // Build the map texture while waiting in the lobby, not on the match's first frame (a visible hitch).
    else if (map) this.baseFor(map)
    this.shader?.draw(this.scene)
    renderHud(this.hud, game, socket, now, !this.touchUi)
    renderOverlays(this.hud, game, now, this.touchUi)
    // Last, so the event feed cannot bury the survivors' way out.
    this.drawEdgeMarkers()
  }

  private paintWorld(game: ClientGame, map: TileMap, snapshot: SnapshotPayload, self: Positioned, now: number): void {
    const context = this.sceneContext
    const shake = this.effects.shakeOffset(now)
    const focusX = Math.round(self.renderX * TILE_W + TILE_W / 2)
    const focusY = Math.round(self.renderY * TILE_H + TILE_H / 2)
    const view: View = {
      originX: viewportOrigin(focusX, map.width * TILE_W, this.scene.width) + shake.dx * 2,
      originY: viewportOrigin(focusY, map.height * TILE_H, this.scene.height) + shake.dy,
    }
    const toX = (worldPx: number) => Math.round(worldPx - view.originX)
    const toY = (worldPx: number) => Math.round(worldPx - view.originY)

    context.imageSmoothingEnabled = false
    context.drawImage(this.baseFor(map), -view.originX, -view.originY)
    paintGenerators(context, snapshot.generators, toX, toY, now)
    if (game.match?.gateOpen) paintOpenGate(context, map.findAll('gate'), toX, toY, now)

    const brightness = this.lighting(game, map, snapshot, self)
    this.rememberSeen(map, brightness)
    this.applyLight(map, brightness, snapshot.you.role, view)

    this.paintTrailsAndTraps(snapshot, toX, toY)
    this.trackOwnAttack(snapshot, now)
    const others = game.others(now)
    this.animator.forget(new Set([...others.map((e) => e.id), self.id]))
    // Back to front: sprites lower on screen overlap the ones behind them.
    const drawOrder = [...others, ...(snapshot.you.hidden ? [] : [self])].sort((a, b) => a.renderY - b.renderY)
    for (const entity of drawOrder) {
      this.paintEntity(entity, snapshot, map, brightness, toX, toY, now, entity === self)
      if (entity.activity === 'repair') this.effects.sparkle(entity.x, entity.y, now)
    }
    this.paintSounds(snapshot, self, toX, toY)
    this.paintEffects(self, toX, toY, now)
    // Being carried off shakes the picture, so it never happens quietly.
    if (snapshot.you.takenProgress > 0) this.effects.shakeUntilMs = Math.max(this.effects.shakeUntilMs, now + TAKEN_SHAKE_MS)
    this.paintScreenTint(snapshot, now)
    if (snapshot.you.role === 'survivor') {
      this.labelTeammates(others, toX, toY)
      const gate = gateMarkerFor(map, self, view, game.match?.gateOpen ?? false)
      if (gate) this.edgeMarkers.push(gate)
    }
    // A sonar sweep reaches far past the screen, so ping every survivor it found.
    else if (snapshot.you.sonarActive) this.edgeMarkers.push(...sonarMarkers(snapshot, self, view))
    if (this.showBotDebug) this.labelBots(snapshot, toX, toY)
  }

  /**
   * Pointers to things worth running to (or after) that the screen is too small to show: the survivors' gate, and
   * whoever a sonar sweep just found. Each sits on its target when it is in view and clamps to the screen edge,
   * still pointing at it, when it is not.
   */
  private drawEdgeMarkers(): void {
    const markers = this.edgeMarkers
    this.edgeMarkers = []
    const lastRow = Math.max(HUD_TOP_ROWS + 1, this.hud.rows - HUD_BOTTOM_ROWS - 1)
    const feedTop = feedFirstRow(!this.touchUi)
    const taken: { row: number; from: number; to: number }[] = []
    for (const marker of markers) {
      const length = [...marker.text].length
      const cell = this.hudCell(marker.sceneX, marker.sceneY)
      const column = clamp(cell.column - Math.floor(length / 2), 1, Math.max(1, this.hud.columns - length - 1))
      // The event feed runs down the right edge; start below it rather than print over each other.
      const wanted = column + length > this.hud.columns / 2 && cell.row < feedTop + FEED_MAX_ROWS
        ? feedTop + FEED_MAX_ROWS
        : cell.row
      const overlaps = (row: number) => taken.some((other) => other.row === row
        && other.from <= column + length - 1 && column <= other.to)
      let row = clamp(wanted, HUD_TOP_ROWS + 1, lastRow)
      // Several pings can land on one cell (survivors huddled together); stack them instead of overprinting.
      while (row < lastRow && overlaps(row)) row++
      if (overlaps(row)) continue
      taken.push({ row, from: column, to: column + length - 1 })
      this.hud.fillCells(column, row, length, 1, MARKER_PANEL)
      this.hud.drawText(column, row, marker.text, marker.color)
    }
  }

  private baseFor(map: TileMap): HTMLCanvasElement {
    if (this.mapBase?.map !== map) this.mapBase = { map, canvas: renderMapBase(map) }
    return this.mapBase.canvas
  }

  // ------------------------------------------------------------------ lighting

  private lighting(game: ClientGame, map: TileMap, snapshot: SnapshotPayload, self: Positioned): Float32Array {
    const you = snapshot.you
    const viewer = { x: self.x, y: self.y }
    const lights: LightSource[] = [
      { position: viewer, radius: you.role === 'monster' ? GameRules.monster.visionRadius : lightRadius(you.flashlight) },
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

  private applyLight(map: TileMap, brightness: Float32Array, role: string, view: View): void {
    const seen = this.seen!
    this.lightMap.apply(this.sceneContext, map, (i) => {
      const ambient = seen[i] ? AMBIENT_REMEMBERED : AMBIENT_UNSEEN
      return Math.min(1, Math.max(ambient, brightness[i] * LIGHT_BOOST))
    }, role === 'monster' ? MONSTER_TINT : SURVIVOR_TINT, view.originX, view.originY)
  }

  private lightAt(map: TileMap, brightness: Float32Array, x: number, y: number): number {
    return map.isInside(x, y) ? brightness[y * map.width + x] : 0
  }

  // ------------------------------------------------------------------ world objects

  private paintTrailsAndTraps(snapshot: SnapshotPayload, toX: (x: number) => number, toY: (y: number) => number): void {
    const context = this.sceneContext
    for (const trail of snapshot.trails) {
      const fade = 1 - trail.age * 0.8
      const color = [TRAIL_RGB[0] * fade, TRAIL_RGB[1] * fade, TRAIL_RGB[2] * fade] as const
      const x = trail.x * TILE_W
      const y = trail.y * TILE_H
      fill(context, toX(x + 3), toY(y + 4), 2, 1, color)
      fill(context, toX(x + 7), toY(y + 2), 1, 1, color)
      fill(context, toX(x + 8), toY(y + 5), 2, 1, color)
    }
    for (const trap of snapshot.traps) {
      const x = toX(trap.x * TILE_W + 3)
      const y = toY(trap.y * TILE_H + 2)
      fill(context, x + 2, y, 2, 1, TRAP_RGB)
      fill(context, x + 1, y + 1, 4, 1, TRAP_RGB)
      fill(context, x, y + 2, 6, 1, TRAP_RGB)
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

  private paintEntity(
    entity: Positioned,
    snapshot: SnapshotPayload,
    map: TileMap,
    brightness: Float32Array,
    toX: (x: number) => number,
    toY: (y: number) => number,
    now: number,
    isSelf: boolean,
  ): void {
    const animation = this.animator.frame(entity, now)
    const { pose, phase } = animation
    const facing = this.channelFacing(entity, snapshot) ?? animation.facing
    const feetX = toX(entity.renderX * TILE_W + TILE_W / 2)
    const feetY = toY(entity.renderY * TILE_H + TILE_H - 1)
    const context = this.sceneContext
    context.globalAlpha = isSelf
      ? 1
      : Math.max(ENTITY_MIN_BRIGHTNESS, Math.min(1, this.lightAt(map, brightness, entity.x, entity.y) * LIGHT_BOOST))
    withRigTransform(context, feetX, feetY, facing, RIG_SCALE, this.cellAspect(), () => {
      if (entity.kind === 'monster') drawMonster(context, pose, phase)
      else drawSurvivor(context, pose, phase, {
        body: this.bodyColor(entity, now),
        injured: entity.health === 'injured',
        flashlight: entity.flashlight,
      })
    })
    context.globalAlpha = 1
  }

  /**
   * While channelling, face what is being worked on (the nearest generator, or the teammate being revived or
   * healed) instead of the last walking direction. Null when not channelling or the target is straight above/below.
   */
  private channelFacing(entity: Positioned, snapshot: SnapshotPayload): Facing | null {
    if (entity.activity === 'none') return null
    const candidates: { x: number; y: number }[] = entity.activity === 'repair'
      ? snapshot.generators
      : snapshot.entities.filter((other) => other.id !== entity.id && other.kind === 'survivor'
        && other.health === (entity.activity === 'revive' ? 'downed' : entity.activity === 'heal' ? 'injured' : ''))
    let nearest: { x: number; y: number } | null = null
    let best = Infinity
    for (const target of candidates) {
      const distance = Math.max(Math.abs(target.x - entity.x), Math.abs(target.y - entity.y))
      if (distance < best) {
        best = distance
        nearest = target
      }
    }
    if (!nearest || nearest.x === entity.x) return null
    return nearest.x > entity.x ? 1 : -1
  }

  /** Character cells are about twice as tall as wide; rigs are squashed vertically to stay in proportion. */
  private cellAspect(): number {
    const cell = this.shader?.cellSizeCss()
    return cell ? cell.width / cell.height : 0.5
  }

  private bodyColor(entity: EntityView, now: number): string {
    if (entity.health === 'injured' && Math.floor(now / BLINK_MS) % 2 === 0) return INJURED_COLOR
    return entity.color
  }

  // ------------------------------------------------------------------ effects

  /** The monster hears noises as arcs `)))` around itself, pointing towards the source. */
  private paintSounds(snapshot: SnapshotPayload, self: Positioned, toX: (x: number) => number, toY: (y: number) => number): void {
    const centerX = self.renderX * TILE_W + TILE_W / 2
    const centerY = self.renderY * TILE_H + TILE_H / 2
    for (const sound of snapshot.sounds) {
      const base = parseHex(SOUND_COLORS[sound.kind] ?? '#ffffff')
      const angle = Math.atan2(sound.dy, sound.dx)
      const arcs = Math.max(1, Math.round(sound.intensity * 3))
      for (let arc = 0; arc < arcs; arc++) {
        const radius = SOUND_RING_TILES + arc * 0.8
        const fade = (0.5 + 0.5 * sound.intensity) * (1 - arc * 0.2)
        const color = [base[0] * fade, base[1] * fade, base[2] * fade] as const
        for (let step = -4; step <= 4; step++) {
          const a = angle + step * 0.07
          fill(this.sceneContext, toX(centerX + Math.cos(a) * radius * TILE_W), toY(centerY + Math.sin(a) * radius * TILE_H), 1, 1, color)
        }
      }
    }
  }

  private paintEffects(self: Positioned, toX: (x: number) => number, toY: (y: number) => number, now: number): void {
    const context = this.sceneContext
    for (const particle of this.effects.visibleParticles(now)) {
      const { x, y, life } = this.effects.particlePosition(particle, now)
      const rgb = parseHex(particle.color)
      const fade = 0.4 + 0.6 * life
      fill(context, toX(x * TILE_W + TILE_W / 2), toY(y * TILE_H + TILE_H / 2), 1, 1, [rgb[0] * fade, rgb[1] * fade, rgb[2] * fade])
    }
    const sonar = this.effects.sonarRadius(now, GameRules.monster.sonarRadius)
    if (sonar === null) return
    const origin = this.effects.sonarOrigin ?? { x: self.x, y: self.y }
    const points = Math.ceil(sonar * 40)
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2
      fill(context, toX((origin.x + 0.5 + Math.cos(a) * sonar) * TILE_W), toY((origin.y + 0.5 + Math.sin(a) * sonar) * TILE_H), 1, 1, SONAR_RGB)
    }
  }

  /** Hit flash and the survivor heartbeat vignette, painted into the scene so they turn into ASCII too. */
  private paintScreenTint(snapshot: SnapshotPayload, now: number): void {
    const context = this.sceneContext
    const { width, height } = this.scene
    const flash = this.effects.flashAlpha(now)
    if (flash > 0) {
      context.globalAlpha = flash
      context.fillStyle = this.effects.flashColor
      context.fillRect(0, 0, width, height)
      context.globalAlpha = 1
    }
    const taken = snapshot.you.takenProgress
    if (taken > 0) {
      // Closes in from the edges as the monster finishes hauling this survivor away.
      const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * (0.45 - taken * 0.35),
        width / 2, height / 2, Math.max(width, height) * 0.7)
      gradient.addColorStop(0, 'rgba(120, 0, 0, 0)')
      gradient.addColorStop(1, `rgba(190, 0, 0, ${(0.35 + 0.65 * taken) * TAKEN_TINT_ALPHA})`)
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    }
    const terror = snapshot.you.terror
    if (terror > 0 && snapshot.you.role === 'survivor') {
      const beatsPerSecond = 1 + terror * 1.8
      const pulse = Math.pow(Math.max(0, Math.sin((now / 1000) * Math.PI * beatsPerSecond)), 8)
      const gradient = context.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.25,
        width / 2, height / 2, Math.max(width, height) * 0.62)
      gradient.addColorStop(0, 'rgba(120, 0, 0, 0)')
      gradient.addColorStop(1, `rgba(150, 0, 0, ${Math.min(0.85, terror * (0.35 + 0.5 * pulse))})`)
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    }
  }

  // ------------------------------------------------------------------ text labels (HUD layer)

  /** Maps a scene pixel to a HUD grid cell (the two layers have different glyph sizes). */
  /** A box in CSS pixels → the same box in scene pixels (one per world character cell). */
  private sceneArea(boxCss: DOMRect): SceneArea {
    const cell = this.shader!.cellSizeCss()
    return {
      x: Math.round(boxCss.x / cell.width),
      y: Math.round(boxCss.y / cell.height),
      width: Math.round(boxCss.width / cell.width),
      height: Math.round(boxCss.height / cell.height),
    }
  }

  private hudCell(sceneX: number, sceneY: number): { column: number; row: number } {
    const world = this.shader!.cellSizeCss()
    const hud = this.hud.cellSizeCss()
    return {
      column: Math.round((sceneX * world.width) / hud.width),
      row: Math.round((sceneY * world.height) / hud.height),
    }
  }

  private labelTeammates(others: readonly Positioned[], toX: (x: number) => number, toY: (y: number) => number): void {
    for (const entity of others) {
      if (entity.kind !== 'survivor') continue
      const label = entity.name.replace(' (bot)', '')
      const { column, row } = this.hudCell(toX(entity.renderX * TILE_W + TILE_W / 2), toY(entity.renderY * TILE_H - TILE_H))
      this.hud.drawText(column - Math.floor(label.length / 2), row, label, NAME_COLOR)
    }
  }

  private labelBots(snapshot: SnapshotPayload, toX: (x: number) => number, toY: (y: number) => number): void {
    for (const bot of snapshot.bots ?? []) {
      bot.path.forEach((cell, index) => {
        if (index === 0) return
        const { column, row } = this.hudCell(toX(cell.x * TILE_W + TILE_W / 2), toY(cell.y * TILE_H + TILE_H / 2))
        this.hud.drawGlyph(column, row, '∙', BOT_DEBUG_COLOR)
      })
      const head = bot.path[0]
      if (head) {
        const { column, row } = this.hudCell(toX(head.x * TILE_W + TILE_W), toY(head.y * TILE_H - 8))
        this.hud.drawText(column, row, `#${bot.id} ${bot.state}`, BOT_DEBUG_COLOR)
      }
    }
  }
}

function lightRadius(flashlightOn: boolean): number {
  return flashlightOn ? GameRules.survivor.flashlightRadius : GameRules.survivor.darkRadius
}

function createShader(canvas: HTMLCanvasElement): AsciiShader | null {
  try {
    return new AsciiShader(canvas)
  } catch (error) {
    console.error('ASCII shader unavailable; the world will not render', error)
    return null
  }
}

/** Arrows for the eight directions, counter-clockwise from "right"; screen y grows downwards. */
const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'] as const

function arrowFor(dx: number, dy: number): string {
  return ARROWS[((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8]
}

/** A pointer drawn over the world (or clamped to the screen edge), in scene pixels. */
interface EdgeMarker {
  readonly sceneX: number
  readonly sceneY: number
  readonly text: string
  readonly color: string
}

function marker(x: number, y: number, self: Positioned, view: View, label: string, color: string): EdgeMarker {
  const dx = x - self.renderX
  const dy = y - self.renderY
  return {
    sceneX: x * TILE_W + TILE_W / 2 - view.originX,
    sceneY: y * TILE_H + TILE_H / 2 - view.originY,
    text: `${arrowFor(dx, dy)} ${label} ${Math.round(Math.hypot(dx, dy))}`,
    color,
  }
}

function gateMarkerFor(map: TileMap, self: Positioned, view: View, open: boolean): EdgeMarker | null {
  const gate = nearestGate(map, self)
  if (!gate) return null
  return marker(gate.x, gate.y, self, view, open ? 'GATE OPEN' : 'gate', open ? GATE_OPEN_COLOR : GATE_LOCKED_COLOR)
}

/** While the sonar is active, every survivor it revealed gets a ping the monster can chase. */
function sonarMarkers(snapshot: SnapshotPayload, self: Positioned, view: View): EdgeMarker[] {
  return snapshot.entities
    .filter((entity) => entity.kind === 'survivor' && entity.id !== self.id)
    .map((entity) => marker(entity.x, entity.y, self, view, entity.name, SONAR_PING_COLOR))
}

function nearestGate(map: TileMap, from: Positioned): { x: number; y: number } | null {
  let nearest: { x: number; y: number } | null = null
  let best = Infinity
  for (const gate of map.findAll('gate')) {
    const distance = Math.hypot(gate.x - from.renderX, gate.y - from.renderY)
    if (distance < best) {
      best = distance
      nearest = gate
    }
  }
  return nearest
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
