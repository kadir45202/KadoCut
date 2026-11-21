import type { Animated, Transform, TransitionType } from '@shared/project/schema'
import { defaultTransform } from '@shared/project/defaults'

/**
 * Photo durations: `perPhoto` seconds each, or cut on the music's beats — the beat nearest to the
 * target length, never shorter than 60 % of it. Falls back to `perPhoto` where the beats run out.
 */
export function slideDurations(count: number, perPhoto: number, beats: number[] = []): number[] {
  const sorted = [...beats].sort((a, b) => a - b)
  const out: number[] = []
  let cursor = 0
  for (let i = 0; i < count; i++) {
    const target = cursor + perPhoto
    let best: number | null = null
    for (const b of sorted) {
      if (b < cursor + perPhoto * 0.6) continue
      if (b > cursor + perPhoto * 1.6) break
      if (best === null || Math.abs(b - target) < Math.abs(best - target)) best = b
    }
    const d = (best ?? target) - cursor
    out.push(Math.round(d * 1000) / 1000)
    cursor += d
  }
  return out
}

/** Scale (relative to "contain") that makes a w×h picture cover the canvas. */
export function coverScale(w: number, h: number, cw: number, ch: number): number {
  if (!w || !h) return 1
  return Math.max(cw / w, ch / h) / Math.min(cw / w, ch / h)
}

const keyed = (from: number, to: number, duration: number): Animated => ({
  value: from,
  keys: [
    { t: 0, v: from, e: 'linear' },
    { t: duration, v: to, e: 'linear' }
  ]
})

/** Slow zoom / pan for photo `index` (four alternating moves), on top of `base` scale. */
export function kenBurns(index: number, duration: number, base: number): Transform {
  const tr = defaultTransform()
  const z = base * 1.14
  switch (index % 4) {
    case 0:
      return { ...tr, scale: keyed(base, z, duration) }
    case 1:
      return { ...tr, scale: keyed(z, base, duration) }
    case 2:
      return { ...tr, scale: { value: base * 1.12, keys: [] }, x: keyed(-0.035, 0.035, duration) }
    default:
      return { ...tr, scale: { value: base * 1.12, keys: [] }, y: keyed(0.03, -0.03, duration) }
  }
}

const MIXED: TransitionType[] = ['dissolve', 'slideLeft', 'zoomIn', 'iris', 'spin', 'push']

/** Transition into photo `index` (none into the first). */
export function slideTransition(index: number, mode: 'none' | 'dissolve' | 'flash' | 'mixed'): TransitionType | null {
  if (index === 0 || mode === 'none') return null
  return mode === 'mixed' ? MIXED[(index - 1) % MIXED.length] : mode
}
