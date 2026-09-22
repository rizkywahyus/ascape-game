/** Colour helpers. Results are quantised so the glyph atlas holds a bounded number of colour variants. */

type Rgb = readonly [number, number, number]

const QUANTUM = 8
const cache = new Map<string, Rgb>()

export function parseHex(hex: string): Rgb {
  let rgb = cache.get(hex)
  if (!rgb) {
    const value = Number.parseInt(hex.slice(1, 7), 16)
    rgb = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
    cache.set(hex, rgb)
  }
  return rgb
}

function toHex([r, g, b]: Rgb): string {
  const channel = (value: number) => {
    const quantised = Math.min(255, Math.max(0, Math.round(value / QUANTUM) * QUANTUM))
    return quantised.toString(16).padStart(2, '0')
  }
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Linear blend: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t])
}

export function scale(color: string, factor: number): string {
  const [r, g, b] = parseHex(color)
  return toHex([r * factor, g * factor, b * factor])
}

/**
 * A tile colour under light: brightens the base by up to `gain` and pulls it towards the light's tint.
 * `brightness` 0 returns the base scaled by `ambient`. Solid blocks use a lower gain than thin glyphs,
 * because a filled cell reads much brighter than a dot at the same colour.
 */
export function lit(base: string, tint: string, brightness: number, ambient: number, gain: number): string {
  if (brightness <= 0) return scale(base, ambient)
  const boosted = scale(base, 1 + brightness * gain)
  return mix(boosted, tint, brightness * 0.3)
}
