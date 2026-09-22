import type { Facing, Pose } from '../animator'

/**
 * Characters drawn as small vector rigs (head, torso, limbs) with gradients, so the ASCII shader has real shading
 * to turn into characters. Coordinates are in "rig units": x to the right in scene pixels, y up from the feet.
 * The caller's transform maps them onto the scene (flip for facing, squash y for the 1:2 character cells).
 */

export interface RigStyle {
  readonly body: string
  readonly injured: boolean
  readonly flashlight: boolean
}

const SKIN_LIGHT = '#f2cfa5'
const SKIN_DARK = '#9c6b45'
const HAIR = '#2e2018'
const TROUSERS = '#3d4d6e'
const TROUSERS_DARK = '#1d2538'
const SHOES = '#151515'
const BLOOD = '#8f1a12'
/** Drawn under every limb: the shader turns it into blank space, giving the figure a readable silhouette. */
const OUTLINE = '#020202'
const OUTLINE_WIDTH = 1.4

const MONSTER_SKIN = '#c23a2c'
const MONSTER_DARK = '#6a150e'
const MONSTER_HIGHLIGHT = '#ff7a5c'
const MONSTER_EYE = '#ffe14a'
const BONE = '#ece3cf'

/** Survivor ≈ 36 rig units tall; the monster ≈ 54. */
export const SURVIVOR_HEIGHT = 36
export const MONSTER_HEIGHT = 54

// ---------------------------------------------------------------- survivor

export function drawSurvivor(context: CanvasRenderingContext2D, pose: Pose, phase: number, style: RigStyle): void {
  if (pose === 'downed') {
    drawDownedSurvivor(context, style)
    return
  }
  const running = pose === 'run'
  const moving = pose === 'walk' || running
  const crouch = pose === 'repair'
  const swing = moving ? Math.sin(phase) * (running ? 0.95 : 0.55) : 0
  const lean = running ? 4 : crouch ? 7 : 0
  const bob = moving ? Math.abs(Math.cos(phase)) * (running ? 2 : 1) : pose === 'idle' ? Math.sin(phase) * 0.4 : 0
  const hipY = crouch ? 9 : 16 + bob

  // Legs: back leg first so the front one overlaps it.
  drawLeg(context, 0, hipY, -swing, crouch, TROUSERS_DARK)
  drawLeg(context, 0, hipY, swing, crouch, TROUSERS)

  const neck = { x: lean, y: hipY + 12 }
  const shoulder = { x: neck.x, y: neck.y - 1 }
  // Upper-arm angle (0 = hanging down, positive = in front) and elbow flexion (always ≥ 0: a real elbow only
  // folds the forearm forward/up). Repairing: elbows low, forearms level, hands working alternately.
  const backArm = crouch ? 0.75 + Math.sin(phase * 2) * 0.12 : swing * 0.9
  const frontArm = crouch ? 0.9 + Math.cos(phase * 2) * 0.15 : -swing * 0.9
  const flex = crouch ? 0.75 : running ? 1.3 : moving ? 0.35 : 0.15

  // The far arm goes behind the torso so the body partly hides it.
  drawArm(context, shoulder.x - 0.5, shoulder.y, backArm, flex, shade(style.body, 0.5))

  const torso = context.createLinearGradient(-5, 0, 5, 0)
  torso.addColorStop(0, shade(style.body, 1.05))
  torso.addColorStop(1, shade(style.body, 0.45))
  limb(context, 0, -hipY, neck.x, -neck.y, 7.5, torso)
  if (style.injured) {
    dot(context, neck.x * 0.5 + 1, -(hipY + 5), 1.6, BLOOD)
    dot(context, neck.x * 0.5 - 2, -(hipY + 8), 1.2, BLOOD)
  }

  const hand = drawArm(context, shoulder.x + 0.5, shoulder.y, frontArm, flex, shade(style.body, 0.85))
  if (style.flashlight && !crouch) dot(context, hand.x + 1, -hand.y, 1.5, '#fff6cf') // the torch

  drawHead(context, neck.x + 0.5, neck.y + 5)
}

function drawLeg(context: CanvasRenderingContext2D, hipX: number, hipY: number, angle: number, crouch: boolean, color: string): void {
  const thigh = 8.5
  const shin = 8.5
  const thighAngle = crouch ? 1.1 : angle
  const knee = { x: hipX + Math.sin(thighAngle) * thigh, y: hipY - Math.cos(thighAngle) * thigh }
  // Knees bend backwards more on the back swing, like a stride.
  const shinAngle = crouch ? -0.4 : thighAngle - Math.max(0, -angle) * 1.2 - 0.1
  const foot = { x: knee.x + Math.sin(shinAngle) * shin, y: Math.max(0, knee.y - Math.cos(shinAngle) * shin) }
  limb(context, hipX, -hipY, knee.x, -knee.y, 3.6, color)
  limb(context, knee.x, -knee.y, foot.x, -foot.y, 3.2, color)
  limb(context, foot.x - 0.5, -foot.y, foot.x + 2.8, -foot.y, 2.4, SHOES)
}

/**
 * Upper arm at `angle` from hanging straight down (positive = forward), forearm folded a further `flex` radians
 * forward/up at the elbow, like a real elbow. Returns the hand position.
 */
function drawArm(
  context: CanvasRenderingContext2D,
  shoulderX: number,
  shoulderY: number,
  angle: number,
  flex: number,
  color: string,
): { x: number; y: number } {
  const upper = 6.5
  const lower = 6
  const elbow = { x: shoulderX + Math.sin(angle) * upper, y: shoulderY - Math.cos(angle) * upper }
  const forearm = angle + Math.max(0, flex)
  const hand = { x: elbow.x + Math.sin(forearm) * lower, y: elbow.y - Math.cos(forearm) * lower }
  limb(context, shoulderX, -shoulderY, elbow.x, -elbow.y, 3, color)
  limb(context, elbow.x, -elbow.y, hand.x, -hand.y, 2.6, color)
  dot(context, hand.x, -hand.y, 1.7, SKIN_LIGHT)
  return hand
}

function drawHead(context: CanvasRenderingContext2D, x: number, y: number): void {
  const face = context.createRadialGradient(x + 1.5, -y - 1.5, 0.5, x, -y, 5)
  face.addColorStop(0, SKIN_LIGHT)
  face.addColorStop(1, SKIN_DARK)
  ellipse(context, x, -y, 4, 4.6, face)
  // Hair covers the back and top of the head (the character faces +x).
  context.fillStyle = HAIR
  context.beginPath()
  context.ellipse(x - 1, -y - 1.4, 4.3, 3.6, 0, Math.PI * 0.85, Math.PI * 2.05)
  context.fill()
  dot(context, x + 2.6, -y + 0.2, 0.7, '#140c08') // eye
}

function drawDownedSurvivor(context: CanvasRenderingContext2D, style: RigStyle): void {
  ellipse(context, 2, -1, 15, 2.6, BLOOD)
  limb(context, -12, -3, -3, -3, 3.4, TROUSERS)
  limb(context, -12, -1, -3, -1.5, 3.2, TROUSERS_DARK)
  const torso = context.createLinearGradient(0, -6, 0, 0)
  torso.addColorStop(0, shade(style.body, 1.1))
  torso.addColorStop(1, shade(style.body, 0.5))
  limb(context, -3, -3, 8, -3.5, 7.5, torso)
  limb(context, 6, -5, 11, -8, 2.6, shade(style.body, 0.8)) // reaching arm
  dot(context, 11.5, -8.5, 1.6, SKIN_LIGHT)
  drawHead(context, 13, 3.5)
}

// ---------------------------------------------------------------- monster

export function drawMonster(context: CanvasRenderingContext2D, pose: Pose, phase: number): void {
  const moving = pose === 'walk' || pose === 'lunge'
  const lunge = pose === 'lunge'
  const stride = moving ? Math.sin(phase) * (lunge ? 1.0 : 0.6) : 0
  const breathe = Math.sin(phase * 0.8) * 0.8
  const hipY = lunge ? 16 : 20
  const stretch = lunge ? 1.35 : 1

  // Digitigrade legs.
  drawBeastLeg(context, -4, hipY, -stride, MONSTER_DARK)
  drawBeastLeg(context, 4, hipY, stride, shade(MONSTER_SKIN, 0.7))

  // Hunched torso: a big shaded mass leaning forward.
  const bodyX = 3 * stretch
  const bodyY = hipY + 13 + breathe
  const torso = context.createRadialGradient(bodyX + 3, -bodyY - 5, 2, bodyX, -bodyY, 17)
  torso.addColorStop(0, MONSTER_HIGHLIGHT)
  torso.addColorStop(0.55, MONSTER_SKIN)
  torso.addColorStop(1, MONSTER_DARK)
  context.save()
  context.translate(bodyX, -bodyY)
  context.rotate(lunge ? 0.5 : 0.28)
  ellipse(context, 0, 0, 14 * stretch, 12, torso)
  // Spine ridges.
  context.fillStyle = MONSTER_DARK
  for (let i = -2; i <= 2; i++) triangle(context, -3 + i * 5, -11, -1 + i * 5, -16, 1 + i * 5, -11)
  context.restore()

  // Arms: long, hanging to the ground, claws out. The front arm swipes when attacking.
  const shoulder = { x: bodyX + 7 * stretch, y: bodyY + 4 }
  const attack = pose === 'attack'
  const backAngle = attack ? 0.6 : 0.25 + stride * 0.5
  const frontAngle = attack ? 1.9 : pose === 'catch' ? 0.6 : lunge ? 1.5 : 0.15 - stride * 0.5
  drawBeastArm(context, shoulder.x - 8, shoulder.y + 1, backAngle, MONSTER_DARK)

  drawBeastHead(context, shoulder.x + 6 * stretch, shoulder.y + 6 + breathe, pose === 'attack' || lunge)
  drawBeastArm(context, shoulder.x, shoulder.y, frontAngle, shade(MONSTER_SKIN, 0.9))
}

function drawBeastLeg(context: CanvasRenderingContext2D, hipX: number, hipY: number, angle: number, color: string): void {
  const knee = { x: hipX + 5 + Math.sin(angle) * 5, y: hipY - 8 }
  const ankle = { x: knee.x - 5 + Math.sin(angle) * 4, y: 5 }
  const toe = { x: ankle.x + 5, y: 0 }
  limb(context, hipX, -hipY, knee.x, -knee.y, 6, color)
  limb(context, knee.x, -knee.y, ankle.x, -ankle.y, 4.5, color)
  limb(context, ankle.x, -ankle.y, toe.x, -toe.y, 3.5, color)
  claw(context, toe.x, -toe.y, 0.1)
}

function drawBeastArm(context: CanvasRenderingContext2D, x: number, y: number, angle: number, color: string): void {
  const upper = 14
  const lower = 14
  const elbow = { x: x + Math.sin(angle) * upper, y: y - Math.cos(angle) * upper }
  const hand = { x: elbow.x + Math.sin(angle * 1.2) * lower, y: Math.max(2, elbow.y - Math.cos(angle * 0.6) * lower) }
  limb(context, x, -y, elbow.x, -elbow.y, 5, color)
  limb(context, elbow.x, -elbow.y, hand.x, -hand.y, 4, color)
  const clawAngle = Math.atan2(-(hand.y - elbow.y), hand.x - elbow.x)
  for (let i = -1; i <= 1; i++) claw(context, hand.x, -hand.y, clawAngle + i * 0.35)
}

function drawBeastHead(context: CanvasRenderingContext2D, x: number, y: number, jawOpen: boolean): void {
  // Horns sweep back over the head.
  context.fillStyle = BONE
  triangle(context, x - 3, -y - 5, x - 12, -y - 15, x - 1, -y - 8)
  triangle(context, x + 1, -y - 6, x - 5, -y - 18, x + 3, -y - 8)

  const skull = context.createRadialGradient(x + 2, -y - 2, 1, x, -y, 9)
  skull.addColorStop(0, MONSTER_HIGHLIGHT)
  skull.addColorStop(1, MONSTER_DARK)
  ellipse(context, x, -y, 8, 6.5, skull)

  // Open jaw with teeth.
  const jaw = jawOpen ? 5 : 2.5
  ellipse(context, x + 4, -y + 3, 5, jaw, '#0b0202')
  context.fillStyle = BONE
  for (let i = 0; i < 4; i++) {
    const tx = x + 1 + i * 2
    triangle(context, tx, -y + 3 - jaw + 0.5, tx + 1, -y + 3 - jaw + 2.5, tx + 2, -y + 3 - jaw + 0.5)
    triangle(context, tx, -y + 3 + jaw - 0.5, tx + 1, -y + 3 + jaw - 2.5, tx + 2, -y + 3 + jaw - 0.5)
  }

  // Glowing eyes: a bright core plus an additive halo.
  for (const eyeX of [x + 1.5, x + 5.5]) {
    const glow = context.createRadialGradient(eyeX, -y - 2, 0, eyeX, -y - 2, 5)
    glow.addColorStop(0, 'rgba(255, 225, 74, 0.9)')
    glow.addColorStop(1, 'rgba(255, 120, 20, 0)')
    context.save()
    context.globalCompositeOperation = 'lighter'
    context.fillStyle = glow
    context.fillRect(eyeX - 5, -y - 7, 10, 10)
    context.restore()
    ellipse(context, eyeX, -y - 2, 1.5, 1.1, MONSTER_EYE)
  }
}

function claw(context: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  stroke(context, x, y, x + Math.cos(angle) * 5, y - Math.sin(angle) * 5, 1.4, BONE)
}

// ---------------------------------------------------------------- primitives

function limb(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number,
  style: string | CanvasGradient): void {
  stroke(context, x1, y1, x2, y2, width + OUTLINE_WIDTH, OUTLINE)
  stroke(context, x1, y1, x2, y2, width, style)
}

function stroke(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, width: number,
  style: string | CanvasGradient): void {
  context.strokeStyle = style
  context.lineWidth = width
  context.lineCap = 'round'
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.stroke()
}

function ellipse(context: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number,
  style: string | CanvasGradient, outlined = true): void {
  if (outlined && rx > 2) {
    context.fillStyle = OUTLINE
    context.beginPath()
    context.ellipse(x, y, rx + OUTLINE_WIDTH / 2, ry + OUTLINE_WIDTH / 2, 0, 0, Math.PI * 2)
    context.fill()
  }
  context.fillStyle = style
  context.beginPath()
  context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
  context.fill()
}

function dot(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ellipse(context, x, y, radius, radius, color)
}

function triangle(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.lineTo(x3, y3)
  context.closePath()
  context.fill()
}

function shade(hex: string, factor: number): string {
  const value = Number.parseInt(hex.slice(1, 7), 16)
  const channel = (shift: number) => Math.min(255, Math.round(((value >> shift) & 0xff) * factor))
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`
}

/** Applies facing, size and the cell aspect so rig units come out in proportion on screen. */
export function withRigTransform(context: CanvasRenderingContext2D, feetX: number, feetY: number, facing: Facing,
  scale: number, cellAspect: number, draw: () => void): void {
  context.save()
  context.translate(feetX, feetY)
  context.scale(facing * scale, scale * cellAspect)
  draw()
  context.restore()
}
