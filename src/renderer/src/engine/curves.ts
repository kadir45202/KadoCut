import type { CurvePoint, Curves } from '@shared/project/schema'

/** 256-entry lookup per channel; the master curve is applied first, then the channel's own. */
export const CURVE_SIZE = 256

export const isIdentityCurve = (points: CurvePoint[]) => points.every((p) => Math.abs(p.x - p.y) < 1e-4)

export const curvesNeutral = (c: Curves) => isIdentityCurve(c.master) && isIdentityCurve(c.r) && isIdentityCurve(c.g) && isIdentityCurve(c.b)

/**
 * Monotone cubic (Fritsch–Carlson) through the points: smooth like a photo editor's curve but
 * never overshooting between points. Returns y for CURVE_SIZE evenly spaced x in [0, 1].
 */
export function curveTable(input: CurvePoint[]): Float32Array {
  const pts = [...input].sort((a, b) => a.x - b.x).filter((p, i, arr) => i === 0 || p.x - arr[i - 1].x > 1e-4)
  const out = new Float32Array(CURVE_SIZE)
  if (pts.length < 2) {
    for (let i = 0; i < CURVE_SIZE; i++) out[i] = i / (CURVE_SIZE - 1)
    return out
  }
  const n = pts.length
  const d = new Array<number>(n - 1)
  for (let i = 0; i < n - 1; i++) d[i] = (pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x)
  const m = new Array<number>(n)
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
      const tau = 3 / Math.sqrt(s)
      m[i] = tau * a * d[i]
      m[i + 1] = tau * b * d[i]
    }
  }
  let seg = 0
  for (let i = 0; i < CURVE_SIZE; i++) {
    const x = i / (CURVE_SIZE - 1)
    let y: number
    if (x <= pts[0].x) y = pts[0].y
    else if (x >= pts[n - 1].x) y = pts[n - 1].y
    else {
      while (seg < n - 2 && x > pts[seg + 1].x) seg++
      const h = pts[seg + 1].x - pts[seg].x
      const t = (x - pts[seg].x) / h
      const t2 = t * t
      const t3 = t2 * t
      y = (2 * t3 - 3 * t2 + 1) * pts[seg].y + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * pts[seg + 1].y + (t3 - t2) * h * m[seg + 1]
    }
    out[i] = Math.min(1, Math.max(0, y))
  }
  return out
}

/** RGBA8 texture data: per channel, channel curve ∘ master curve. */
export function curvesTexture(c: Curves): Uint8Array {
  const master = curveTable(c.master)
  const channels = [curveTable(c.r), curveTable(c.g), curveTable(c.b)]
  const data = new Uint8Array(CURVE_SIZE * 4)
  for (let i = 0; i < CURVE_SIZE; i++) {
    const mi = Math.round(master[i] * (CURVE_SIZE - 1))
    for (let ch = 0; ch < 3; ch++) data[i * 4 + ch] = Math.round(channels[ch][mi] * 255)
    data[i * 4 + 3] = 255
  }
  return data
}

export const curvesKey = (c: Curves) => JSON.stringify(c)
