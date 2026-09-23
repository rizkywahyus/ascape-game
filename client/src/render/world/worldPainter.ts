import type { TileMap } from '../../game/tileMap'
import type { GeneratorView } from '../../net/protocol'

/** One map tile covers TILE_W × TILE_H scene pixels, i.e. character cells (≈ square with 1:2 glyphs). */
export const TILE_W = 28
export const TILE_H = 14

type Rgb = readonly [number, number, number]

const FLOOR: Rgb = [62, 54, 47]
const FLOOR_VARIATION = 18
const WALL_BRICK: Rgb = [150, 138, 128]
const WALL_MORTAR: Rgb = [52, 46, 44]
const WALL_TOP: Rgb = [150, 140, 132]
const WALL_FACE: Rgb = [40, 34, 32]
const BRICK_W = 9
const BRICK_H = 4
const LOCKER_BODY: Rgb = [120, 78, 40]
const LOCKER_EDGE: Rgb = [70, 44, 22]
const LOCKER_SLOT: Rgb = [30, 20, 12]
const GENERATOR_BODY: Rgb = [96, 88, 70]
const GENERATOR_EDGE: Rgb = [48, 44, 34]
const GAUGE_EMPTY: Rgb = [30, 34, 22]
const GAUGE_FULL: Rgb = [110, 240, 140]
const LAMP_IDLE: Rgb = [255, 190, 60]
const LAMP_DONE: Rgb = [120, 255, 150]
const SMOKE: Rgb = [90, 86, 78]
/** Generator size in scene pixels (one per character cell): three tiles wide, reaching above its own tile. */
const GENERATOR_WIDTH = TILE_W * 3 - 4
const GENERATOR_HEIGHT = 22
const EXHAUST_HEIGHT = 4
const PLINTH_HEIGHT = 2
const WHEEL_RADIUS = 7
const WHEEL_SPOKES = 6
const WHEEL_PERIOD_MS = 900
const SMOKE_PERIOD_MS = 1400
const GATE_BAR: Rgb = [150, 150, 160]
const GATE_GAP: Rgb = [18, 18, 22]

/**
 * Pre-renders the static map (bricks, floor, lockers, generator casings, closed gate) at TILE_W × TILE_H pixels
 * per tile. Interior walls with no floor next to them stay black, so rooms read as rooms.
 */
export function renderMapBase(map: TileMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = map.width * TILE_W
  canvas.height = map.height * TILE_H
  const context = canvas.getContext('2d')!
  const image = context.createImageData(canvas.width, canvas.height)
  const set = (x: number, y: number, rgb: Rgb) => {
    const offset = (y * canvas.width + x) * 4
    image.data[offset] = rgb[0]
    image.data[offset + 1] = rgb[1]
    image.data[offset + 2] = rgb[2]
    image.data[offset + 3] = 255
  }
  for (let ty = 0; ty < map.height; ty++) {
    for (let tx = 0; tx < map.width; tx++) {
      const kind = map.tileAt(tx, ty).kind
      for (let py = 0; py < TILE_H; py++) {
        for (let px = 0; px < TILE_W; px++) {
          const x = tx * TILE_W + px
          const y = ty * TILE_H + py
          const rgb = baseColor(map, kind, tx, ty, px, py, x, y)
          if (rgb) set(x, y, rgb)
          else set(x, y, [0, 0, 0])
        }
      }
    }
  }
  context.putImageData(image, 0, 0)
  return canvas
}

function baseColor(map: TileMap, kind: string, tx: number, ty: number, px: number, py: number, x: number, y: number): Rgb | null {
  switch (kind) {
    case 'wall':
      return wallColor(map, tx, ty, py, x, y)
    case 'locker':
      return lockerColor(px, py, x, y)
    case 'generator':
    case 'generatorFrame':
      return floorColor(x, y)
    case 'gate':
      return px % 3 === 0 ? GATE_BAR : GATE_GAP
    default:
      return floorColor(x, y)
  }
}

function floorColor(x: number, y: number): Rgb {
  const noise = hash(x, y)
  const grit = noise > 0.985 ? 40 : 0 // occasional pebbles catch the light
  const shade = (noise - 0.5) * FLOOR_VARIATION + grit
  return [FLOOR[0] + shade, FLOOR[1] + shade, FLOOR[2] + shade * 0.8]
}

function wallColor(map: TileMap, tx: number, ty: number, py: number, x: number, y: number): Rgb | null {
  if (!isEdgeWall(map, tx, ty)) return null
  const floorBelow = map.isInside(tx, ty + 1) && map.tileAt(tx, ty + 1).kind !== 'wall'
  // The rows facing the room below are the wall's front face, in shadow: that reads as height.
  if (floorBelow && py >= TILE_H - 3) return shadeRgb(WALL_FACE, 0.7 + (TILE_H - py) * 0.12)
  const floorAbove = map.isInside(tx, ty - 1) && map.tileAt(tx, ty - 1).kind !== 'wall'
  if (floorAbove && py === 0) return WALL_TOP
  const row = Math.floor(y / BRICK_H)
  const offset = row % 2 === 0 ? 0 : BRICK_W / 2
  const mortar = y % BRICK_H === BRICK_H - 1 || (x + offset) % BRICK_W === 0
  if (mortar) return WALL_MORTAR
  const shade = (hash(Math.floor((x + offset) / BRICK_W), row) - 0.5) * 36
  return [WALL_BRICK[0] + shade, WALL_BRICK[1] + shade, WALL_BRICK[2] + shade]
}

function lockerColor(px: number, py: number, x: number, y: number): Rgb {
  const left = 6
  const right = TILE_W - 7
  if (px < left || px > right) return floorColor(x, y)
  if (px === left || px === right || py === 0 || py === TILE_H - 1) return LOCKER_EDGE
  if (py >= 2 && py <= 5 && px > left + 2 && px < right - 2 && py % 2 === 0) return LOCKER_SLOT
  // Light falls from the left: a subtle gradient across the door gives the shader something to shade.
  return shadeRgb(LOCKER_BODY, 1.2 - (px - left) / (right - left) * 0.5)
}

const edgeWalls = new WeakMap<TileMap, Uint8Array>()

function isEdgeWall(map: TileMap, x: number, y: number): boolean {
  let edges = edgeWalls.get(map)
  if (!edges) {
    edges = new Uint8Array(map.width * map.height)
    for (let ty = 0; ty < map.height; ty++) {
      for (let tx = 0; tx < map.width; tx++) {
        let edge = false
        for (let dy = -1; dy <= 1 && !edge; dy++) {
          for (let dx = -1; dx <= 1 && !edge; dx++) {
            edge = map.isInside(tx + dx, ty + dy) && map.tileAt(tx + dx, ty + dy).kind !== 'wall'
          }
        }
        edges[ty * map.width + tx] = edge ? 1 : 0
      }
    }
    edgeWalls.set(map, edges)
  }
  return edges[y * map.width + x] === 1
}

/**
 * Generator machines (3 tiles wide, centred on the `G` tile): casing, a gauge that fills with progress and two
 * lamps. Drawn every frame into the scene because progress and "done" change.
 */
export function paintGenerators(
  context: CanvasRenderingContext2D,
  generators: readonly GeneratorView[],
  toSceneX: (worldPx: number) => number,
  toSceneY: (worldPx: number) => number,
  nowMs: number,
): void {
  for (const generator of generators) {
    const left = toSceneX((generator.x - 1) * TILE_W + 2)
    // The machine stands on its tile and reaches up into the one above, so it reads as a thing, not a stripe.
    const base = toSceneY(generator.y * TILE_H + TILE_H - 1)
    const top = base - GENERATOR_HEIGHT
    const progress = generator.done ? 1 : generator.progress ?? 0
    paintGenerator(context, left, top, base, progress, generator.done, nowMs)
  }
}

/** One generator: fins and casing on the left, flywheel on the right, exhaust on top, gauge and lamps in front. */
function paintGenerator(context: CanvasRenderingContext2D, left: number, top: number, base: number, progress: number,
  done: boolean, nowMs: number): void {
  const bodyWidth = GENERATOR_WIDTH - WHEEL_RADIUS * 2 - 2
  const bodyTop = top + EXHAUST_HEIGHT
  const bodyHeight = base - PLINTH_HEIGHT - bodyTop
  const wheelX = left + bodyWidth + WHEEL_RADIUS
  const wheelY = base - PLINTH_HEIGHT - WHEEL_RADIUS - 1

  // Exhaust pipe, with smoke once the generator runs.
  fill(context, left + 8, top, 4, EXHAUST_HEIGHT + 2, GENERATOR_EDGE)
  fill(context, left + 9, top, 2, EXHAUST_HEIGHT + 1, shadeRgb(GENERATOR_BODY, 0.8))
  if (done) paintSmoke(context, left + 10, top, nowMs)

  // Casing.
  const casing = context.createLinearGradient(0, bodyTop, 0, bodyTop + bodyHeight)
  casing.addColorStop(0, css(shadeRgb(GENERATOR_BODY, 1.5)))
  casing.addColorStop(1, css(shadeRgb(GENERATOR_BODY, 0.5)))
  fill(context, left, bodyTop, bodyWidth, bodyHeight, GENERATOR_EDGE)
  context.fillStyle = casing
  context.fillRect(left + 1, bodyTop + 1, bodyWidth - 2, bodyHeight - 2)

  // Cooling fins along the left half.
  for (let fin = left + 3; fin < left + bodyWidth / 2; fin += 3) {
    fill(context, fin, bodyTop + 3, 1, bodyHeight - 6, GENERATOR_EDGE)
  }

  // Gauge and lamps on the right half of the casing.
  const gaugeLeft = left + Math.round(bodyWidth / 2) + 2
  const gaugeWidth = bodyWidth - (gaugeLeft - left) - 4
  fill(context, gaugeLeft, bodyTop + 4, gaugeWidth, 3, GAUGE_EMPTY)
  fill(context, gaugeLeft, bodyTop + 4, Math.round(gaugeWidth * progress), 3, GAUGE_FULL)
  const blink = !done && Math.floor(nowMs / 500) % 2 === 0
  const lamp = done ? LAMP_DONE : blink ? LAMP_IDLE : scale(LAMP_IDLE, 0.45)
  fill(context, gaugeLeft, bodyTop + 9, 3, 2, lamp)
  fill(context, gaugeLeft + 5, bodyTop + 9, 3, 2, lamp)

  // Flywheel: spokes turn while the generator runs.
  const spin = done ? (nowMs / WHEEL_PERIOD_MS) * Math.PI * 2 : Math.PI / 8
  context.strokeStyle = css(shadeRgb(GENERATOR_BODY, 1.2))
  context.lineWidth = 1
  context.beginPath()
  context.arc(wheelX, wheelY, WHEEL_RADIUS, 0, Math.PI * 2)
  context.stroke()
  context.strokeStyle = css(GENERATOR_EDGE)
  context.beginPath()
  context.arc(wheelX, wheelY, WHEEL_RADIUS - 2, 0, Math.PI * 2)
  context.stroke()
  context.strokeStyle = css(shadeRgb(GENERATOR_BODY, 1.4))
  for (let spoke = 0; spoke < WHEEL_SPOKES; spoke++) {
    const angle = spin + (spoke * Math.PI * 2) / WHEEL_SPOKES
    context.beginPath()
    context.moveTo(wheelX, wheelY)
    context.lineTo(wheelX + Math.cos(angle) * (WHEEL_RADIUS - 1), wheelY + Math.sin(angle) * (WHEEL_RADIUS - 1))
    context.stroke()
  }
  fill(context, wheelX - 1, wheelY - 1, 2, 2, done ? LAMP_DONE : GENERATOR_EDGE)

  // Plinth and feet.
  fill(context, left - 1, base - PLINTH_HEIGHT, GENERATOR_WIDTH + 2, PLINTH_HEIGHT, GENERATOR_EDGE)
  fill(context, left + 1, base - 1, 4, 1, shadeRgb(GENERATOR_BODY, 0.7))
  fill(context, left + GENERATOR_WIDTH - 5, base - 1, 4, 1, shadeRgb(GENERATOR_BODY, 0.7))
}

/** Three puffs drifting up from the exhaust, so a running generator reads at a glance. */
function paintSmoke(context: CanvasRenderingContext2D, x: number, top: number, nowMs: number): void {
  for (let puff = 0; puff < 3; puff++) {
    const phase = ((nowMs / SMOKE_PERIOD_MS + puff / 3) % 1)
    const size = 1 + Math.round(phase * 2)
    fill(context, Math.round(x + Math.sin(phase * Math.PI * 2) * 2 - size / 2), Math.round(top - 1 - phase * 6),
      size, size, scale(SMOKE, 1 - phase))
  }
}

export function paintOpenGate(
  context: CanvasRenderingContext2D,
  gates: readonly { x: number; y: number }[],
  toSceneX: (worldPx: number) => number,
  toSceneY: (worldPx: number) => number,
  nowMs: number,
): void {
  const flicker = 0.6 + 0.4 * Math.sin(nowMs / 90)
  for (const gate of gates) {
    fill(context, toSceneX(gate.x * TILE_W), toSceneY(gate.y * TILE_H), TILE_W, TILE_H, scale([255, 255, 240], flicker))
  }
}

export function fill(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, rgb: Rgb): void {
  context.fillStyle = `rgb(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0})`
  context.fillRect(x, y, width, height)
}

function scale(rgb: Rgb, factor: number): Rgb {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor]
}

function shadeRgb(rgb: Rgb, factor: number): Rgb {
  return [Math.min(255, rgb[0] * factor), Math.min(255, rgb[1] * factor), Math.min(255, rgb[2] * factor)]
}

function css(rgb: Rgb): string {
  return `rgb(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0})`
}

/** Stable pseudo-random value in [0, 1) per pixel, so textures do not flicker. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/**
 * Multiplies a scene by a per-tile light map, scaled up with smoothing so light falls off gradually across each
 * tile instead of in blocks. The image buffer is reused between frames.
 */
export class LightMap {
  private readonly canvas = document.createElement('canvas')
  private image: ImageData | null = null

  /** `valueAt(i)` is the final 0..1 light of tile i (row-major); `tint` the light colour as 0..1 channels. */
  apply(
    context: CanvasRenderingContext2D,
    map: TileMap,
    valueAt: (tileIndex: number) => number,
    tint: readonly [number, number, number],
    originX: number,
    originY: number,
  ): void {
    const lightContext = this.canvas.getContext('2d')!
    if (this.canvas.width !== map.width || this.canvas.height !== map.height || !this.image) {
      this.canvas.width = map.width
      this.canvas.height = map.height
      this.image = lightContext.createImageData(map.width, map.height)
    }
    const data = this.image.data
    for (let i = 0; i < map.width * map.height; i++) {
      const value = valueAt(i)
      data[i * 4] = 255 * value * tint[0]
      data[i * 4 + 1] = 255 * value * tint[1]
      data[i * 4 + 2] = 255 * value * tint[2]
      data[i * 4 + 3] = 255
    }
    lightContext.putImageData(this.image, 0, 0)
    context.save()
    context.globalCompositeOperation = 'multiply'
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(this.canvas, -originX, -originY, map.width * TILE_W, map.height * TILE_H)
    context.restore()
  }
}
