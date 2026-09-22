import { GlyphAtlas } from './glyphAtlas'

const LINE_HEIGHT_RATIO = 1.2
const CELL_MEASURE_GLYPH = 'M'

/**
 * A canvas that fills its container with a grid of fixed-size character cells.
 * Works in device pixels so glyphs stay crisp on high-DPI screens.
 */
export class AsciiGrid {
  columns = 0
  rows = 0
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly fontFamily: string
  private readonly fontSizeCss: number
  private cellWidth = 0
  private cellHeight = 0
  private atlas: GlyphAtlas | null = null
  private atlasPixelRatio = 0

  constructor(canvas: HTMLCanvasElement, fontFamily: string, fontSizeCss: number) {
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('2D canvas context unavailable')
    this.canvas = canvas
    this.context = context
    this.fontFamily = fontFamily
    this.fontSizeCss = fontSizeCss
  }

  /** Recomputes the grid to fill `widthCss` × `heightCss`. Call on window resize. */
  resize(widthCss: number, heightCss: number): void {
    const pixelRatio = window.devicePixelRatio || 1
    if (pixelRatio !== this.atlasPixelRatio) this.rebuildAtlas(pixelRatio)

    this.columns = Math.max(1, Math.floor((widthCss * pixelRatio) / this.cellWidth))
    this.rows = Math.max(1, Math.floor((heightCss * pixelRatio) / this.cellHeight))
    this.canvas.width = this.columns * this.cellWidth
    this.canvas.height = this.rows * this.cellHeight
    this.canvas.style.width = `${this.canvas.width / pixelRatio}px`
    this.canvas.style.height = `${this.canvas.height / pixelRatio}px`
  }

  clear(color: string): void {
    this.context.fillStyle = color
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
  }

  /** Column and row may be fractional (sub-cell positions for smooth movement). */
  drawGlyph(column: number, row: number, glyph: string, color: string): void {
    if (column <= -1 || row <= -1 || column >= this.columns || row >= this.rows) return
    const x = Math.round(column * this.cellWidth)
    const y = Math.round(row * this.cellHeight)
    this.requireAtlas().draw(this.context, glyph, color, x, y)
  }

  /** Solid rectangle behind cells, e.g. a panel background. */
  fillCells(column: number, row: number, columns: number, rows: number, color: string): void {
    this.context.fillStyle = color
    this.context.fillRect(column * this.cellWidth, row * this.cellHeight, columns * this.cellWidth, rows * this.cellHeight)
  }

  /** Translucent colour over the whole canvas (hit flash). */
  tint(color: string, alpha: number): void {
    this.context.save()
    this.context.globalAlpha = alpha
    this.context.fillStyle = color
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.context.restore()
  }

  /** Colour creeping in from the edges (heartbeat). */
  vignette(color: string, alpha: number): void {
    const { width, height } = this.canvas
    const gradient = this.context.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.3,
      width / 2, height / 2, Math.max(width, height) * 0.7,
    )
    gradient.addColorStop(0, 'transparent')
    gradient.addColorStop(1, color)
    this.context.save()
    this.context.globalAlpha = Math.min(alpha, 1)
    this.context.fillStyle = gradient
    this.context.fillRect(0, 0, width, height)
    this.context.restore()
  }

  /** Writes text and returns the column after it. */
  drawText(column: number, row: number, text: string, color: string): number {
    const glyphs = [...text]
    glyphs.forEach((glyph, offset) => {
      if (glyph !== ' ') this.drawGlyph(column + offset, row, glyph, color)
    })
    return column + glyphs.length
  }

  private rebuildAtlas(pixelRatio: number): void {
    const font = `${Math.round(this.fontSizeCss * pixelRatio)}px ${this.fontFamily}`
    this.context.font = font
    this.cellWidth = Math.ceil(this.context.measureText(CELL_MEASURE_GLYPH).width)
    this.cellHeight = Math.ceil(this.fontSizeCss * pixelRatio * LINE_HEIGHT_RATIO)
    this.atlas = new GlyphAtlas(font, this.cellWidth, this.cellHeight)
    this.atlasPixelRatio = pixelRatio
  }

  private requireAtlas(): GlyphAtlas {
    if (!this.atlas) throw new Error('AsciiGrid.resize() must be called before drawing')
    return this.atlas
  }
}
