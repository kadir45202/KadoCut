import type { Animated, Keyframe, VideoClip } from '@shared/project/schema'
import { localTimeForSourceOffset } from '@renderer/core/project/speed'

export interface FaceFrame {
  /** Source seconds. */
  t: number
  faces: { x: number; y: number; w: number; h: number; score: number }[]
}

/** Seconds between generated keyframes. */
const KEY_STEP = 0.5

/** Picks one face per frame, preferring the one closest to the previous pick (then the largest). */
export function primaryFaces(frames: FaceFrame[]): ({ cx: number; cy: number; size: number } | null)[] {
  let prev: { cx: number; cy: number; size: number } | null = null
  return frames.map((f) => {
    let best: { cx: number; cy: number; size: number } | null = null
    let bestScore = -Infinity
    for (const face of f.faces) {
      const cand = { cx: face.x + face.w / 2, cy: face.y + face.h * 0.45, size: Math.max(face.w, face.h) }
      const dist = prev ? Math.hypot(cand.cx - prev.cx, cand.cy - prev.cy) : 0
      const score = cand.size - dist * 2
      if (score > bestScore) {
        bestScore = score
        best = cand
      }
    }
    if (best) prev = best
    return best
  })
}

/** Fills gaps by holding the nearest known value, then smooths with a centred moving average. */
export function smoothTrack(values: (number | null)[], window: number): number[] {
  const known = values.findIndex((v) => v !== null)
  if (known < 0) return values.map(() => 0.5)
  const filled: number[] = []
  let last = values[known] as number
  for (const v of values) {
    if (v !== null) last = v
    filled.push(last)
  }
  const half = Math.max(0, Math.floor(window / 2))
  return filled.map((_, i) => {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - half); j <= Math.min(filled.length - 1, i + half); j++) {
      sum += filled[j]
      n++
    }
    return sum / n
  })
}

export interface Reframe {
  scale: Animated
  x: Animated
  y: Animated
}

/**
 * Transform that fills the canvas with the clip ("cover") and pans to keep the main face
 * centred, without ever showing the canvas background. `smooth` is in seconds.
 */
export function planReframe(
  clip: VideoClip,
  media: { width: number; height: number },
  canvas: { width: number; height: number },
  frames: FaceFrame[],
  sampleFps: number,
  smooth: number
): Reframe {
  const fit = Math.min(canvas.width / media.width, canvas.height / media.height)
  const cover = Math.max(canvas.width / media.width, canvas.height / media.height) / fit
  const shownW = media.width * fit * cover
  const shownH = media.height * fit * cover
  const faces = primaryFaces(frames)
  const window = Math.round(smooth * sampleFps)
  const xs = smoothTrack(faces.map((f) => f?.cx ?? null), window)
  const ys = smoothTrack(faces.map((f) => f?.cy ?? null), window)
  const maxX = Math.max(0, (shownW - canvas.width) / 2)
  const maxY = Math.max(0, (shownH - canvas.height) / 2)
  // Offset (fraction of canvas) that moves face position u to the centre, clamped to the edges.
  const offset = (u: number, shown: number, max: number, size: number) => Math.min(max, Math.max(-max, -(u - 0.5) * shown)) / size

  const keysX: Keyframe[] = []
  const keysY: Keyframe[] = []
  let nextKey = -Infinity
  frames.forEach((f, i) => {
    const local = localTimeForSourceOffset(clip.speed, clip.duration, Math.max(0, f.t - clip.in))
    if (local < nextKey - 1e-6 && i !== frames.length - 1) return
    nextKey = local + KEY_STEP
    const t = Math.min(clip.duration, local)
    if (keysX.length && Math.abs(keysX[keysX.length - 1].t - t) < 1e-3) return
    keysX.push({ t, v: offset(xs[i], shownW, maxX, canvas.width), e: 'linear' })
    keysY.push({ t, v: offset(ys[i], shownH, maxY, canvas.height), e: 'linear' })
  })
  const animated = (keys: Keyframe[]): Animated => {
    const constant = keys.every((k) => Math.abs(k.v - keys[0].v) < 1e-4)
    return constant || keys.length < 2 ? { value: keys[0]?.v ?? 0, keys: [] } : { value: keys[0].v, keys }
  }
  return { scale: { value: cover, keys: [] }, x: animated(keysX), y: animated(keysY) }
}
