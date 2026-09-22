import manorSource from '../../../../shared/maps/manor.map.txt?raw'
import { computeLighting, type LightSource } from '../../game/lighting'
import { GameRules } from '../../game/rules'
import { TileMap } from '../../game/tileMap'
import { drawMonster, drawSurvivor, RIG_SCALE, withRigTransform } from '../world/rig'
import { LightMap, paintGenerators, renderMapBase, TILE_H, TILE_W } from '../world/worldPainter'
import { attractStateAt, STAGE, type ActorState } from './attractTimeline'

const TINT = [1.0, 0.9, 0.74] as const
/** The whole hall is faintly visible, so the stage reads even between the flashlights. */
const AMBIENT = 0.2
const LIGHT_BOOST = 1.25
const MONSTER_MIN_ALPHA = 0.35
const INJURED_COLOR = '#e74c3c'
const BLINK_MS = 400
/** Where the stage sits on screen: right of centre, leaving room for the menu panels on the left. */
const STAGE_SCREEN_X = 0.72
const STAGE_SCREEN_Y = 0.52
/** The scene is drawn zoomed out (vs. the game) so the whole chase fits beside the panels. */
const ZOOM = 0.85
/**
 * In an inset box (small screens) the view is cropped tight around the chase: feet move between rows 11 and 17 and
 * heads reach about two tiles higher, so rows 9–18 are framed, centred a little above the stage's focus.
 */
const INSET_VIEW_TILES = { width: 10, height: 9 } as const
const INSET_FOCUS_Y = 13.5
const PHASE_CYCLE_MS: Record<string, number> = { idle: 2200, walk: 400, run: 260, repair: 700, lunge: 280, attack: 1000 }

/** A rectangle in scene pixels. */
export interface SceneArea {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** A caption to draw over a character, in scene pixels. */
export interface SceneLabel {
  readonly sceneX: number
  readonly sceneY: number
  readonly text: string
  readonly color: string
}

/** Paints the menu's attract-mode scene (see attractTimeline) with the same painter and rigs as the game. */
export class AttractScene {
  private readonly map = TileMap.parse(manorSource)
  private readonly base = renderMapBase(this.map)
  private readonly lightMap = new LightMap()
  private lighting: { key: string; brightness: Float32Array } | null = null

  /**
   * Paints the scene across the whole canvas with the stage right of centre (wide screens, menu on the left), or,
   * given `inset`, only inside that box with the stage centred and zoomed to fit.
   */
  paint(context: CanvasRenderingContext2D, width: number, height: number, cellAspect: number, nowMs: number,
    inset: SceneArea | null = null): SceneLabel[] {
    const state = attractStateAt(nowMs / 1000)
    const focusX = STAGE.focus.x * TILE_W + TILE_W / 2
    const focusY = (inset ? INSET_FOCUS_Y : STAGE.focus.y) * TILE_H + TILE_H / 2
    const area = inset ?? { x: 0, y: 0, width, height }
    const zoom = inset
      ? Math.min(inset.width / (INSET_VIEW_TILES.width * TILE_W), inset.height / (INSET_VIEW_TILES.height * TILE_H))
      : ZOOM
    const stageX = inset ? area.x + area.width / 2 : width * STAGE_SCREEN_X
    const stageY = inset ? area.y + area.height / 2 : height * STAGE_SCREEN_Y
    // World pixels → scene pixels: zoomed out and shifted so the stage's focus lands on (stageX, stageY).
    const offsetX = Math.round(stageX - focusX * zoom)
    const offsetY = Math.round(stageY - focusY * zoom)
    const identity = (value: number) => value

    context.save()
    context.beginPath()
    context.rect(area.x, area.y, area.width, area.height)
    context.clip()
    context.setTransform(zoom, 0, 0, zoom, offsetX, offsetY)
    context.imageSmoothingEnabled = false
    context.drawImage(this.base, 0, 0)
    paintGenerators(context, [{ id: 1, ...STAGE.generator, progress: state.generatorProgress, done: false }], identity,
      identity, nowMs)

    const brightness = this.brightness(state.actors)
    this.lightMap.apply(context, this.map, (i) => Math.min(1, Math.max(AMBIENT, brightness[i] * LIGHT_BOOST)) * state.fade,
      TINT, 0, 0)

    const labels: SceneLabel[] = []
    for (const actor of [...state.actors].sort((a, b) => a.y - b.y)) {
      const feetX = actor.x * TILE_W + TILE_W / 2
      const feetY = actor.y * TILE_H + TILE_H - 1
      const light = brightness[Math.round(actor.y) * this.map.width + Math.round(actor.x)] * LIGHT_BOOST
      context.globalAlpha = state.fade * (actor.kind === 'monster' ? Math.max(MONSTER_MIN_ALPHA, Math.min(1, light)) : 1)
      const phase = (((nowMs + actor.id * 137) / (PHASE_CYCLE_MS[actor.pose] ?? 1000)) % 1) * Math.PI * 2
      withRigTransform(context, feetX, feetY, actor.facing, RIG_SCALE, cellAspect, () => {
        if (actor.kind === 'monster') drawMonster(context, actor.pose, phase)
        else drawSurvivor(context, actor.pose, phase, {
          body: this.bodyColor(actor, nowMs),
          injured: actor.health === 'injured',
          flashlight: true,
        })
      })
      context.globalAlpha = 1
      const headroom = (actor.kind === 'monster' ? 58 : 40) * RIG_SCALE * cellAspect
      labels.push({
        sceneX: feetX * zoom + offsetX,
        sceneY: (feetY - headroom) * zoom + offsetY,
        text: actor.label,
        color: actor.kind === 'monster' ? '#e0685a' : '#b8c4cc',
      })
    }
    context.setTransform(1, 0, 0, 1, 0, 0)
    this.paintMood(context, area, stageX, stageY, state.terror, state.flash, nowMs)
    context.restore()
    const inside = (label: SceneLabel) => label.sceneX >= area.x && label.sceneX < area.x + area.width
      && label.sceneY >= area.y && label.sceneY < area.y + area.height
    return state.fade > 0.5 ? labels.filter(inside) : []
  }

  private bodyColor(actor: ActorState, nowMs: number): string {
    return actor.health === 'injured' && Math.floor(nowMs / BLINK_MS) % 2 === 0 ? INJURED_COLOR : actor.color
  }

  /** Survivor flashlights light the hall; cached while nobody changes tile. */
  private brightness(actors: readonly ActorState[]): Float32Array {
    const lights: LightSource[] = actors
      .filter((actor) => actor.kind === 'survivor')
      .map((actor) => ({ position: { x: Math.round(actor.x), y: Math.round(actor.y) }, radius: GameRules.survivor.flashlightRadius }))
    const key = lights.map((l) => `${l.position.x},${l.position.y}`).join(';')
    if (this.lighting?.key !== key) {
      const viewer = { x: Math.round(STAGE.focus.x), y: Math.round(STAGE.focus.y) }
      this.lighting = { key, brightness: computeLighting(this.map, viewer, lights) }
    }
    return this.lighting.brightness
  }

  /** Heartbeat vignette as the monster closes in, and the red flash of the strike. */
  private paintMood(context: CanvasRenderingContext2D, area: SceneArea, stageX: number, stageY: number, terror: number,
    flash: number, nowMs: number): void {
    const shortSide = Math.min(area.width, area.height)
    const longSide = Math.max(area.width, area.height)
    if (terror > 0) {
      const pulse = Math.pow(Math.max(0, Math.sin((nowMs / 1000) * Math.PI * (1 + terror * 1.8))), 8)
      const gradient = context.createRadialGradient(stageX, stageY, shortSide * 0.25, stageX, stageY, longSide * 0.7)
      gradient.addColorStop(0, 'rgba(120, 0, 0, 0)')
      gradient.addColorStop(1, `rgba(150, 0, 0, ${Math.min(0.8, terror * (0.3 + 0.5 * pulse))})`)
      context.fillStyle = gradient
      context.fillRect(area.x, area.y, area.width, area.height)
    }
    if (flash > 0) {
      context.globalAlpha = flash * 0.4
      context.fillStyle = '#c0392b'
      context.fillRect(area.x, area.y, area.width, area.height)
      context.globalAlpha = 1
    }
  }
}
