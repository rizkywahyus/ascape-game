/**
 * Turns a low-resolution scene (1 pixel per character cell) into ASCII on the GPU: each cell picks a glyph from a
 * brightness ramp and is tinted with the pixel's colour. Dark pixels become spaces and dots, so darkness and light
 * come out naturally, like an image-to-ASCII filter.
 */

/** Darkest → brightest. Index 0 (space) keeps unlit areas empty. */
export const GLYPH_RAMP = " .`:,;-~=+*ix#%&@"
/** Glyph colour = pixel colour × this (clamped), so dim-but-visible pixels still read. */
const COLOR_GAIN = 1.75
/** Faint cell background in the pixel colour: fills the gaps between glyphs a little. */
const BACKGROUND_TINT = 0.1
/** < 1 spreads mid-tones over more of the ramp. */
const LUMINANCE_GAMMA = 0.78

const VERTEX_SHADER = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D uScene;
uniform sampler2D uGlyphs;
uniform vec2 uGrid;
uniform vec2 uCellPx;
uniform vec2 uCanvasPx;
uniform float uGlyphCount;
uniform float uColorGain;
uniform float uBackgroundTint;
uniform float uGamma;

void main() {
  vec2 px = vec2(gl_FragCoord.x, uCanvasPx.y - gl_FragCoord.y);
  vec2 cell = floor(px / uCellPx);
  if (cell.x >= uGrid.x || cell.y >= uGrid.y) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 inCell = (px - cell * uCellPx) / uCellPx;
  vec3 color = texture2D(uScene, (cell + 0.5) / uGrid).rgb;
  float luminance = dot(color, vec3(0.299, 0.587, 0.114));
  float index = min(floor(pow(luminance, uGamma) * uGlyphCount), uGlyphCount - 1.0);
  float glyph = texture2D(uGlyphs, vec2((index + inCell.x) / uGlyphCount, inCell.y)).a;
  vec3 ink = min(color * uColorGain, vec3(1.0));
  gl_FragColor = vec4(ink * glyph + color * uBackgroundTint, 1.0);
}
`

export class AsciiShader {
  private readonly gl: WebGLRenderingContext
  private readonly canvas: HTMLCanvasElement
  private readonly program: WebGLProgram
  private readonly sceneTexture: WebGLTexture
  private readonly glyphTexture: WebGLTexture
  private readonly uniforms: Record<string, WebGLUniformLocation | null>
  private cellWidth = 0
  private cellHeight = 0

  /** Throws if WebGL is unavailable; the caller falls back to a plain renderer. */
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL unavailable')
    this.gl = gl
    this.canvas = canvas
    this.program = link(gl, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER), compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
    gl.useProgram(this.program)

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(this.program, 'aPosition')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    this.sceneTexture = createTexture(gl)
    this.glyphTexture = createTexture(gl)
    this.uniforms = Object.fromEntries(
      ['uScene', 'uGlyphs', 'uGrid', 'uCellPx', 'uCanvasPx', 'uGlyphCount', 'uColorGain', 'uBackgroundTint', 'uGamma']
        .map((name) => [name, gl.getUniformLocation(this.program, name)]),
    )
    gl.uniform1i(this.uniforms.uScene, 0)
    gl.uniform1i(this.uniforms.uGlyphs, 1)
    gl.uniform1f(this.uniforms.uGlyphCount, GLYPH_RAMP.length)
    gl.uniform1f(this.uniforms.uColorGain, COLOR_GAIN)
    gl.uniform1f(this.uniforms.uBackgroundTint, BACKGROUND_TINT)
    gl.uniform1f(this.uniforms.uGamma, LUMINANCE_GAMMA)
  }

  /** Sizes the canvas to the window and the grid to the glyph size; returns the grid in cells. */
  resize(widthCss: number, heightCss: number, fontSizeCss: number, fontFamily: string): { columns: number; rows: number } {
    const pixelRatio = window.devicePixelRatio || 1
    this.canvas.width = Math.floor(widthCss * pixelRatio)
    this.canvas.height = Math.floor(heightCss * pixelRatio)
    this.canvas.style.width = `${widthCss}px`
    this.canvas.style.height = `${heightCss}px`
    const fontPx = Math.max(1, Math.round(fontSizeCss * pixelRatio))
    this.buildGlyphAtlas(fontPx, fontFamily)
    const grid = { columns: Math.ceil(this.canvas.width / this.cellWidth), rows: Math.ceil(this.canvas.height / this.cellHeight) }
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.uniform2f(this.uniforms.uGrid, grid.columns, grid.rows)
    gl.uniform2f(this.uniforms.uCellPx, this.cellWidth, this.cellHeight)
    gl.uniform2f(this.uniforms.uCanvasPx, this.canvas.width, this.canvas.height)
    return grid
  }

  /** Size of one character cell in CSS pixels, for mapping world positions onto the HUD layer. */
  cellSizeCss(): { width: number; height: number } {
    const pixelRatio = window.devicePixelRatio || 1
    return { width: this.cellWidth / pixelRatio, height: this.cellHeight / pixelRatio }
  }

  /** Uploads the scene (exactly columns × rows pixels) and draws it as ASCII. */
  draw(scene: HTMLCanvasElement): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private buildGlyphAtlas(fontPx: number, fontFamily: string): void {
    const atlas = document.createElement('canvas')
    const context = atlas.getContext('2d')!
    const font = `${fontPx}px ${fontFamily}`
    context.font = font
    this.cellWidth = Math.max(1, Math.ceil(context.measureText('M').width))
    this.cellHeight = Math.max(1, Math.ceil(fontPx * 1.08))
    atlas.width = this.cellWidth * GLYPH_RAMP.length
    atlas.height = this.cellHeight
    context.font = font
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    ;[...GLYPH_RAMP].forEach((glyph, index) => {
      context.fillText(glyph, index * this.cellWidth + this.cellWidth / 2, this.cellHeight / 2)
    })
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.glyphTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas)
  }
}

function createTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Could not create a WebGL texture')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Non-power-of-two textures in WebGL 1 need clamping and no mipmaps.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  return texture
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`)
  }
  return shader
}

function link(gl: WebGLRenderingContext, vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
  const program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`)
  }
  return program
}
