import { describe, expect, it } from 'vitest'
import type { Asset, VideoClip } from '@shared/project/schema'
import { clipFromAsset } from '@renderer/core/project/factory'
import { setKeyframe, evalAnimated } from '@renderer/core/project/keyframes'
import { sourceRange, sourceTimeAt, splitClip, trimEnd, trimStart, withSpeed } from '@renderer/core/project/clip'
import { CURVE_PRESETS, sourceSpan } from '@renderer/core/project/speed'

const asset: Asset = {
  id: 'a1',
  kind: 'video',
  name: 'clip.mp4',
  path: 'C:/clip.mp4',
  duration: 20,
  width: 1080,
  height: 1920,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  hidden: false,
  derived: null,
  beats: [],
  transcript: null
}

const video = (over: Partial<VideoClip> = {}): VideoClip => ({ ...(clipFromAsset(asset, 'main', 0) as VideoClip), duration: 10, ...over })

describe('split', () => {
  it('splits source range exactly at the cut', () => {
    const c = video({ start: 2, in: 3 })
    const [l, r] = splitClip(c, 6, 'r', 30)!
    expect(l.duration).toBeCloseTo(4)
    expect(r.start).toBeCloseTo(6)
    expect(r.duration).toBeCloseTo(6)
    expect((r as VideoClip).in).toBeCloseTo(7)
  })

  it('refuses cuts shorter than a frame', () => {
    expect(splitClip(video(), 0.01, 'r', 30)).toBeNull()
  })

  it('keeps animation continuous across the cut', () => {
    const c = video()
    c.transform.scale = setKeyframe(setKeyframe(c.transform.scale, 0, 1), 10, 2)
    const [l, r] = splitClip(c, 5, 'r', 30) as [VideoClip, VideoClip]
    const before = evalAnimated(c.transform.scale, 5)
    expect(evalAnimated(l.transform.scale, 5)).toBeCloseTo(before)
    expect(evalAnimated(r.transform.scale, 0)).toBeCloseTo(before)
    expect(evalAnimated(r.transform.scale, 5)).toBeCloseTo(2)
  })

  it('split of a curve clip conserves source material', () => {
    const c = withSpeed(video(), { mode: 'curve', preset: 'hero', points: CURVE_PRESETS.hero })
    const [l, r] = splitClip(c, c.duration * 0.4, 'r', 30) as [VideoClip, VideoClip]
    const [, outBefore] = sourceRange(c)
    const [rin, rout] = sourceRange(r)
    expect(rin).toBeCloseTo(sourceRange(l)[1], 2)
    expect(rout).toBeCloseTo(outBefore, 1)
  })
})

describe('trim', () => {
  it('trimStart moves the in point with the edge', () => {
    const c = video({ start: 5, in: 4 })
    const t = trimStart(c, 7, 30) as VideoClip
    expect(t.start).toBe(7)
    expect(t.duration).toBeCloseTo(8)
    expect(t.in).toBeCloseTo(6)
  })

  it('trimStart cannot go before source time 0', () => {
    const c = video({ start: 5, in: 2 })
    const t = trimStart(c, 0, 30) as VideoClip
    expect(t.in).toBeCloseTo(0)
    expect(t.start).toBeCloseTo(3)
  })

  it('trimEnd is limited by the source length', () => {
    const c = video({ in: 15, duration: 2 })
    const t = trimEnd(c, 100, asset, 30)
    expect(t.duration).toBeCloseTo(5)
  })
})

describe('speed change', () => {
  it('2x halves the duration and keeps the source range', () => {
    const c = video({ duration: 8 })
    const fast = withSpeed(c, { mode: 'constant', rate: 2, preservePitch: true })
    expect(fast.duration).toBeCloseTo(4)
    expect(sourceSpan(fast.speed, fast.duration)).toBeCloseTo(8)
    expect(sourceTimeAt(fast, 2)).toBeCloseTo(4)
  })
})
