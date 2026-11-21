import type { ClipAnimation } from '@shared/project/schema'

/**
 * Preset clip animations (entrance, exit, loop) evaluated at clip-local time. The result is
 * layered on top of the clip's own transform, so keyframes and presets combine.
 */
export interface AnimFx {
  /** Offset in fractions of the canvas size. */
  dx: number
  dy: number
  scale: number
  /** Degrees. */
  rotation: number
  opacity: number
  /** 0..1 share of characters shown (typewriter); 1 shows everything. */
  typed: number
}

export const NO_ANIM: AnimFx = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, typed: 1 }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeIn = (p: number) => p ** 3

/** Overshoots slightly before settling (pop). */
function backOut(p: number): number {
  const c = 1.70158
  return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2
}

function bounceOut(p: number): number {
  const n = 7.5625
  const d = 2.75
  if (p < 1 / d) return n * p * p
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375
  return n * (p -= 2.625 / d) * p + 0.984375
}

const SLIDE = 0.18

export function animAt(anim: ClipAnimation, local: number, duration: number): AnimFx {
  if (anim.in.type === 'none' && anim.out.type === 'none' && anim.loop.type === 'none') return NO_ANIM
  const fx = { ...NO_ANIM }
  // Entrance and exit share the clip when it is shorter than both together.
  const inDur = Math.min(anim.in.duration, duration / 2)
  const outDur = Math.min(anim.out.duration, duration / 2)

  if (anim.in.type !== 'none' && local < inDur) {
    const raw = clamp01(local / inDur)
    const p = easeOut(raw)
    switch (anim.in.type) {
      case 'fade':
        fx.opacity *= raw
        break
      case 'pop':
        fx.scale *= 0.5 + 0.5 * backOut(raw)
        fx.opacity *= clamp01(raw * 3)
        break
      case 'zoomIn':
        fx.scale *= 1.4 - 0.4 * p
        fx.opacity *= raw
        break
      case 'slideUp':
        fx.dy += SLIDE * (1 - p)
        fx.opacity *= raw
        break
      case 'slideDown':
        fx.dy -= SLIDE * (1 - p)
        fx.opacity *= raw
        break
      case 'slideLeft':
        fx.dx += SLIDE * (1 - p)
        fx.opacity *= raw
        break
      case 'slideRight':
        fx.dx -= SLIDE * (1 - p)
        fx.opacity *= raw
        break
      case 'bounce':
        fx.dy -= 0.25 * (1 - bounceOut(raw))
        fx.opacity *= clamp01(raw * 4)
        break
      case 'typewriter':
        fx.typed = raw
        break
    }
  }

  const fromEnd = duration - local
  if (anim.out.type !== 'none' && fromEnd < outDur) {
    const raw = clamp01(fromEnd / outDur)
    const q = 1 - easeIn(1 - raw)
    switch (anim.out.type) {
      case 'fade':
        fx.opacity *= raw
        break
      case 'pop':
        fx.scale *= 0.5 + 0.5 * q
        fx.opacity *= clamp01(raw * 3)
        break
      case 'zoomOut':
        fx.scale *= 1 + 0.4 * (1 - q)
        fx.opacity *= raw
        break
      case 'slideUp':
        fx.dy -= SLIDE * (1 - q)
        fx.opacity *= raw
        break
      case 'slideDown':
        fx.dy += SLIDE * (1 - q)
        fx.opacity *= raw
        break
      case 'slideLeft':
        fx.dx -= SLIDE * (1 - q)
        fx.opacity *= raw
        break
      case 'slideRight':
        fx.dx += SLIDE * (1 - q)
        fx.opacity *= raw
        break
    }
  }

  const wave = Math.sin((2 * Math.PI * local) / anim.loop.period)
  switch (anim.loop.type) {
    case 'pulse':
      fx.scale *= 1 + 0.06 * wave
      break
    case 'wiggle':
      fx.rotation += 4 * Math.sin((4 * Math.PI * local) / anim.loop.period)
      break
    case 'float':
      fx.dy += 0.012 * wave
      break
    case 'swing':
      fx.rotation += 10 * wave
      break
  }
  return fx
}
