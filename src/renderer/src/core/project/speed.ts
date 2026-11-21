import type { Speed, SpeedPoint } from '@shared/project/schema'

/**
 * Speed math. A clip of timeline duration D consumes `D * averageRate` seconds of source.
 * For curves, `points` describe the rate over the normalized clip time u ∈ [0, 1]; the source
 * offset at local time t is D · ∫₀^(t/D) rate(u) du.
 */

export const CURVE_MIN = 0.1
export const CURVE_MAX = 10
export const CONSTANT_MIN = 0.1
export const CONSTANT_MAX = 100

export const CURVE_PRESETS: Record<string, SpeedPoint[]> = {
  montage: pts([0, 1], [0.15, 3], [0.4, 0.5], [0.6, 0.5], [0.85, 3], [1, 1]),
  hero: pts([0, 1.5], [0.35, 1.5], [0.5, 0.2], [0.65, 1.5], [1, 1.5]),
  bullet: pts([0, 4], [0.3, 4], [0.45, 0.2], [0.6, 0.2], [0.75, 4], [1, 4]),
  jumpCut: pts([0, 1], [0.4, 1], [0.5, 5], [0.6, 1], [1, 1]),
  flashIn: pts([0, 5], [0.4, 5], [0.6, 1], [1, 1]),
  flashOut: pts([0, 1], [0.4, 1], [0.6, 5], [1, 5]),
  custom: pts([0, 1], [0.25, 1], [0.5, 1], [0.75, 1], [1, 1])
}

function pts(...p: [number, number][]): SpeedPoint[] {
  return p.map(([x, y]) => ({ x, y }))
}

/** Monotone cubic (Fritsch–Carlson) interpolation: smooth ramps without overshoot. */
export function curveRate(points: readonly SpeedPoint[], u: number): number {
  const n = points.length
  if (u <= points[0].x) return points[0].y
  if (u >= points[n - 1].x) return points[n - 1].y
  let i = 0
  while (i < n - 2 && u > points[i + 1].x) i++
  const tangents = tangentsFor(points)
  const p0 = points[i]
  const p1 = points[i + 1]
  const h = p1.x - p0.x
  if (h <= 0) return p1.y
  const s = (u - p0.x) / h
  const s2 = s * s
  const s3 = s2 * s
  const v =
    (2 * s3 - 3 * s2 + 1) * p0.y + (s3 - 2 * s2 + s) * h * tangents[i] + (-2 * s3 + 3 * s2) * p1.y + (s3 - s2) * h * tangents[i + 1]
  return Math.min(CURVE_MAX, Math.max(CURVE_MIN, v))
}

const tangentCache = new WeakMap<readonly SpeedPoint[], number[]>()

function tangentsFor(points: readonly SpeedPoint[]): number[] {
  const cached = tangentCache.get(points)
  if (cached) return cached
  const n = points.length
  const d: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const h = points[i + 1].x - points[i].x
    d.push(h > 0 ? (points[i + 1].y - points[i].y) / h : 0)
  }
  const m: number[] = new Array(n).fill(0)
  m[0] = d[0]
  m[n - 1] = d[n - 2]
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  tangentCache.set(points, m)
  return m
}

const TABLE_SIZE = 512

/** Cumulative integral table of a curve: cum[i] = ∫₀^(i/N) rate(u) du. */
const tableCache = new WeakMap<readonly SpeedPoint[], Float64Array>()

function cumulative(points: readonly SpeedPoint[]): Float64Array {
  const cached = tableCache.get(points)
  if (cached) return cached
  const cum = new Float64Array(TABLE_SIZE + 1)
  const du = 1 / TABLE_SIZE
  let prev = curveRate(points, 0)
  for (let i = 1; i <= TABLE_SIZE; i++) {
    // Simpson on each cell for accuracy.
    const mid = curveRate(points, (i - 0.5) * du)
    const next = curveRate(points, i * du)
    cum[i] = cum[i - 1] + (du / 6) * (prev + 4 * mid + next)
    prev = next
  }
  tableCache.set(points, cum)
  return cum
}

function cumAt(cum: Float64Array, u: number): number {
  const x = Math.min(1, Math.max(0, u)) * TABLE_SIZE
  const i = Math.min(TABLE_SIZE - 1, Math.floor(x))
  return cum[i] + (cum[i + 1] - cum[i]) * (x - i)
}

export function averageRate(speed: Speed): number {
  return speed.mode === 'constant' ? speed.rate : cumulative(speed.points)[TABLE_SIZE]
}

/** Source seconds consumed by a clip of timeline duration `duration`. */
export function sourceSpan(speed: Speed, duration: number): number {
  return duration * averageRate(speed)
}

/** Timeline duration needed to play `span` seconds of source. */
export function durationForSpan(speed: Speed, span: number): number {
  return span / averageRate(speed)
}

/** Source offset (from the clip's `in`) at clip-local time t. */
export function sourceOffsetAt(speed: Speed, duration: number, t: number): number {
  if (speed.mode === 'constant') return t * speed.rate
  if (duration <= 0) return 0
  return duration * cumAt(cumulative(speed.points), t / duration)
}

/** Instantaneous playback rate at clip-local time t. */
export function rateAt(speed: Speed, duration: number, t: number): number {
  if (speed.mode === 'constant') return speed.rate
  return curveRate(speed.points, duration > 0 ? t / duration : 0)
}

/** Inverse of sourceOffsetAt: clip-local time at which `offset` seconds of source have played. */
export function localTimeForSourceOffset(speed: Speed, duration: number, offset: number): number {
  if (speed.mode === 'constant') return offset / speed.rate
  const cum = cumulative(speed.points)
  const target = offset / duration
  if (target <= 0) return 0
  if (target >= cum[TABLE_SIZE]) return duration
  let lo = 0
  let hi = TABLE_SIZE
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] < target) lo = mid
    else hi = mid
  }
  const frac = (target - cum[lo]) / (cum[hi] - cum[lo] || 1)
  return ((lo + frac) / TABLE_SIZE) * duration
}

/** The part of a curve between u0 and u1, renormalized to [0, 1] (used when splitting/trimming). */
export function subCurve(points: readonly SpeedPoint[], u0: number, u1: number): SpeedPoint[] {
  const span = u1 - u0
  if (span <= 1e-9) return [{ x: 0, y: curveRate(points, u0) }, { x: 1, y: curveRate(points, u0) }]
  const inner = points.filter((p) => p.x > u0 + 1e-6 && p.x < u1 - 1e-6)
  const samples = [u0, ...inner.map((p) => p.x), u1]
  // Dense interior samples so the renormalized spline keeps the original shape.
  for (let i = 1; i < 8; i++) samples.push(u0 + (span * i) / 8)
  const xs = [...new Set(samples)].sort((a, b) => a - b)
  const sub = xs.map((x) => ({ x: (x - u0) / span, y: curveRate(points, x) }))
  // Scale so the part consumes exactly the same source as that stretch of the original
  // curve — otherwise repeated splits would drift by fractions of a frame.
  const cum = cumulative(points)
  const target = (cumAt(cum, u1) - cumAt(cum, u0)) / span
  const k = target / cumulative(sub)[TABLE_SIZE]
  return sub.map((p) => ({ x: p.x, y: Math.min(CURVE_MAX, Math.max(CURVE_MIN, p.y * k)) }))
}
