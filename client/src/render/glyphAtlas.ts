const SLOTS_PER_ROW = 32
const INITIAL_SLOT_ROWS = 8

/** Glyphs drawn as a filled rectangle so walls tile seamlessly regardless of font metrics. */
const SOLID_BLOCK_GLYPHS = new Set(['█'])

/**
 * Each (glyph, color) pair is rasterised once into an offscreen canvas and then
 * blitted with drawImage, which is far cheaper than fillText for every cell each frame.
 * All sizes are in device pixels.
 */
export class GlyphAtlas {
  private canvas: HTMLCanvasElement
  private context: CanvasRenderingContext2D
  private readonly slotIndexByKey = new Map<string, number>()
  private readonly font: string
  private readonly cellWidth: number
  private readonly cellHeight: number

  constructor(font: string, cellWidth: number, cellHeight: number) {
    this.font = font
    this.cellWidth = cellWidth
    this.cellHeight = cellHeight
    this.canvas = document.createElement('canvas')
    this.context = this.createContext(this.canvas, INITIAL_SLOT_ROWS)
  }

  draw(target: CanvasRenderingContext2D, glyph: string, color: string, x: number, y: number): void {
    const slot = this.slotFor(glyph, color)
    const sourceX = (slot % SLOTS_PER_ROW) * this.cellWidth
    const sourceY = Math.floor(slot / SLOTS_PER_ROW) * this.cellHeight
    target.drawImage(
      this.canvas,
      sourceX, sourceY, this.cellWidth, this.cellHeight,
      x, y, this.cellWidth, this.cellHeight,
    )
  }

  private slotFor(glyph: string, color: string): number {
    const key = `${glyph}\u0000${color}`
    const existing = this.slotIndexByKey.get(key)
    if (existing !== undefined) return existing

    const slot = this.slotIndexByKey.size
    this.ensureCapacity(slot + 1)
    this.rasterise(slot, glyph, color)
    this.slotIndexByKey.set(key, slot)
    return slot
  }

  private rasterise(slot: number, glyph: string, color: string): void {
    const x = (slot % SLOTS_PER_ROW) * this.cellWidth
    const y = Math.floor(slot / SLOTS_PER_ROW) * this.cellHeight
    const context = this.context
    context.fillStyle = color

    if (SOLID_BLOCK_GLYPHS.has(glyph)) {
      context.fillRect(x, y, this.cellWidth, this.cellHeight)
      return
    }
    context.save()
    context.beginPath()
    context.rect(x, y, this.cellWidth, this.cellHeight)
    context.clip()
    context.fillText(glyph, x + this.cellWidth / 2, y + this.cellHeight / 2)
    context.restore()
  }

  private ensureCapacity(slotCount: number): void {
    const capacity = (this.canvas.height / this.cellHeight) * SLOTS_PER_ROW
    if (slotCount <= capacity) return

    const grown = document.createElement('canvas')
    const grownContext = this.createContext(grown, (this.canvas.height / this.cellHeight) * 2)
    grownContext.drawImage(this.canvas, 0, 0)
    this.canvas = grown
    this.context = grownContext
  }

  private createContext(canvas: HTMLCanvasElement, slotRows: number): CanvasRenderingContext2D {
    canvas.width = SLOTS_PER_ROW * this.cellWidth
    canvas.height = slotRows * this.cellHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('2D canvas context unavailable')
    context.font = this.font
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    return context
  }
}
