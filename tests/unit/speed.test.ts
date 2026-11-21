import { describe, expect, it } from 'vitest'
import type { Speed } from '@shared/project/schema'
import {
  CURVE_PRESETS,
  averageRate,
  curveRate,
  durationForSpan,
  localTimeForSourceOffset,
  sourceOffsetAt,
  sourceSpan,
  subCurve
} from '@renderer/core/project/speed'

const constant = (rate: number): Speed => ({ mode: 'constant', rate, preservePitch: true })
const curve = (name: string): Extract<Speed, { mode: 'curve' }> => ({ mode: 'curve', preset: name, points: CURVE_PRESETS[name] })

describe('speed', () => {
  it('constant speed maps time linearly', () => {
    expect(sourceSpan(constant(2), 5)).toBeCloseTo(10)
    expect(sourceOffsetAt(constant(0.5), 4, 2)).toBeCloseTo(1)
    expect(durationForSpan(constant(4), 8)).toBeCloseTo(2)
  })

  it('flat curve behaves like 1x', () => {
    const s = curve('custom')
    expect(averageRate(s)).toBeCloseTo(1, 6)
    expect(sourceOffsetAt(s, 10, 3)).toBeCloseTo(3, 4)
  })

  it('curve passes through its control points without overshoot', () => {
    const pts = CURVE_PRESETS.hero
    for (const p of pts) expect(curveRate(pts, p.x)).toBeCloseTo(p.y, 6)
    for (let u = 0; u <= 1; u += 0.01) {
      const r = curveRate(pts, u)
      expect(r).toBeGreaterThanOrEqual(0.2 - 1e-9)
      expect(r).toBeLessThanOrEqual(1.5 + 1e-9)
    }
  })

  it('source offset is monotonic and consistent with the average rate', () => {
    const s = curve('bullet')
    const D = 6
    let prev = -1
    for (let t = 0; t <= D; t += 0.05) {
      const o = sourceOffsetAt(s, D, t)
      expect(o).toBeGreaterThan(prev)
      prev = o
    }
    expect(sourceOffsetAt(s, D, D)).toBeCloseTo(sourceSpan(s, D), 6)
  })

  it('inverse mapping round-trips', () => {
    const s = curve('montage')
    const D = 4
    for (const t of [0, 0.3, 1.7, 2.5, 3.9]) {
      expect(localTimeForSourceOffset(s, D, sourceOffsetAt(s, D, t))).toBeCloseTo(t, 3)
    }
  })

  it('sub-curves preserve the consumed source', () => {
    const s = curve('flashIn')
    const D = 5
    const u = 0.37
    const left: Speed = { ...s, points: subCurve(CURVE_PRESETS.flashIn, 0, u) }
    const right: Speed = { ...s, points: subCurve(CURVE_PRESETS.flashIn, u, 1) }
    const total = sourceSpan(s, D)
    const parts = sourceSpan(left, D * u) + sourceSpan(right, D * (1 - u))
    expect(parts).toBeCloseTo(total, 2)
  })
})
