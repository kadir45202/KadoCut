import { describe, expect, it } from 'vitest'
import type { Marker } from '@shared/project/schema'
import { createEmptyProject } from '@shared/project/defaults'
import { migrateProject } from '@shared/project/migrate'
import { snapPoints } from '@renderer/core/project/timeline'
import { effectNeedsAmount } from '@renderer/engine/scene'
import { curveTable, curvesTexture } from '@renderer/engine/curves'
import { defaultCurves } from '@shared/project/defaults'
import { setFrameRate, sizeFor } from '@renderer/core/project/canvas'
import { clipFromAsset } from '@renderer/core/project/factory'
import { transitionFx } from '@renderer/engine/transitions'
import { coverScale, kenBurns, slideDurations, slideTransition } from '@renderer/modules/slideshow/plan'
import type { Asset } from '@shared/project/schema'
import { chapterStamp, youtubeChapters } from '@renderer/modules/markers/chapters'

const marker = (t: number, label = ''): Marker => ({ id: `m${t}`, t, label, color: 'blue' })
const chapters = (markers: Marker[], duration: number) => youtubeChapters(markers, duration, 'Intro', (n) => `Chapter ${n}`)

describe('YouTube chapters', () => {
  it('starts at 0:00 and names unnamed markers', () => {
    const c = chapters([marker(30, 'Setup'), marker(75)], 120)
    expect(c.text).toBe('00:00 Intro\n00:30 Setup\n01:15 Chapter 2')
    expect(c.count).toBe(3)
    expect(c.ok).toBe(true)
  })

  it('moves a marker near the start to 0:00 instead of adding an intro', () => {
    const c = chapters([marker(0.4, 'Hook'), marker(20, 'B'), marker(40, 'C')], 60)
    expect(c.text.split('\n')[0]).toBe('00:00 Hook')
    expect(c.count).toBe(3)
  })

  it('flags too few and too short chapters', () => {
    expect(chapters([marker(30)], 60).ok).toBe(false)
    const short = chapters([marker(5), marker(30)], 60)
    expect(short.tooShort).toBe(true)
    expect(short.ok).toBe(false)
  })

  it('uses hours for long videos and ignores markers past the end', () => {
    expect(chapterStamp(3725, true)).toBe('1:02:05')
    expect(chapters([marker(100), marker(200), marker(9999)], 3700).text).toBe('0:00:00 Intro\n0:01:40 Chapter 1\n0:03:20 Chapter 2')
  })
})

describe('schema v4', () => {
  it('adds markers and range to older projects', () => {
    const v3 = { ...createEmptyProject({ id: 'p', name: 'P', aspect: '9:16' }), schemaVersion: 3 } as Record<string, unknown>
    delete v3.markers
    delete v3.range
    const p = migrateProject(v3)
    expect(p.schemaVersion).toBe(4)
    expect(p.markers).toEqual([])
    expect(p.range).toBeNull()
  })

  it('markers are snap points', () => {
    const p = { ...createEmptyProject({ id: 'p', name: 'P', aspect: '9:16' }), markers: [marker(2.5)] }
    expect(snapPoints(p, 0, new Set())).toContain(2.5)
  })
})

describe('effects', () => {
  it('split screens and mirrors work without an amount', () => {
    expect(effectNeedsAmount('split4')).toBe(false)
    expect(effectNeedsAmount('mirror')).toBe(false)
    expect(effectNeedsAmount('vhs')).toBe(true)
  })
})

describe('tone curves', () => {
  it('identity stays straight', () => {
    const t = curveTable([{ x: 0, y: 0 }, { x: 1, y: 1 }])
    for (let i = 0; i < t.length; i += 17) expect(t[i]).toBeCloseTo(i / 255, 5)
  })

  it('S-curve is monotone, passes through its points and never overshoots', () => {
    const t = curveTable([{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }])
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1] - 1e-6)
    expect(t[Math.round(0.25 * 255)]).toBeCloseTo(0.18, 1)
    expect(t[Math.round(0.75 * 255)]).toBeCloseTo(0.82, 1)
    expect(Math.min(...t)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...t)).toBeLessThanOrEqual(1)
  })

  it('channel curves apply after the master curve', () => {
    const c = defaultCurves()
    c.master = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }]
    c.r = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }]
    const tex = curvesTexture(c)
    // Everything maps to 0.5 first, then red's curve lifts 0.5 to 1.
    expect(tex[0]).toBe(255)
    expect(tex[1]).toBe(128)
    expect(tex[255 * 4 + 2]).toBe(128)
  })
})

describe('slideshow plan', () => {
  it('uses the fixed length without beats', () => {
    expect(slideDurations(3, 3)).toEqual([3, 3, 3])
  })

  it('cuts on the beat nearest to the target length', () => {
    // 120 BPM: a beat every 0.5 s, offset by 0.1 s.
    const beats = Array.from({ length: 40 }, (_, i) => 0.1 + i * 0.5)
    const d = slideDurations(3, 3, beats)
    let t = 0
    for (const x of d) {
      t += x
      // Every cut lands on a beat.
      expect(beats.some((b) => Math.abs(b - t) < 1e-6)).toBe(true)
      expect(x).toBeGreaterThanOrEqual(1.8)
    }
  })

  it('covers the frame and alternates moves', () => {
    expect(coverScale(1920, 1080, 1080, 1920)).toBeCloseTo((1920 / 1080) * (1920 / 1080), 3)
    expect(coverScale(1080, 1920, 1080, 1920)).toBeCloseTo(1)
    const zoom = kenBurns(0, 3, 1)
    expect(zoom.scale.keys.map((k) => k.t)).toEqual([0, 3])
    expect(zoom.scale.keys[1].v).toBeGreaterThan(zoom.scale.keys[0].v)
    expect(kenBurns(2, 3, 1).x.keys).toHaveLength(2)
    expect(slideTransition(0, 'mixed')).toBeNull()
    expect(slideTransition(1, 'dissolve')).toBe('dissolve')
  })
})

describe('canvas settings', () => {
  it('scales an aspect ratio to a size tier', () => {
    expect(sizeFor('9:16', 2160)).toEqual({ width: 2160, height: 3840 })
    expect(sizeFor('16:9', 720)).toEqual({ width: 1280, height: 720 })
    expect(sizeFor('4:5', 1440)).toEqual({ width: 1440, height: 1800 })
  })

  it('moves edits onto the new frame grid', () => {
    const p = createEmptyProject({ id: 'p', name: 'P', aspect: '9:16' })
    const asset = { id: 'a', kind: 'video', name: 'v', path: 'C:/v.mp4', duration: 10, width: 1080, height: 1920, fps: 30, hasAudio: false, hasVideo: true, hidden: false, derived: null, beats: [], transcript: null } as Asset
    const c = clipFromAsset(asset, 'main', 1 / 30)
    c.duration = 2 + 1 / 30
    p.clips[c.id] = c
    p.markers.push(marker(1 / 3))
    setFrameRate(p, 25)
    expect(p.settings.fps).toBe(25)
    for (const t of [p.clips[c.id].start, p.clips[c.id].start + p.clips[c.id].duration, p.markers[0].t]) expect(Math.abs(t * 25 - Math.round(t * 25))).toBeLessThan(1e-6)
  })
})

describe('new transitions', () => {
  it('spin rotates, iris opens a circle, glitch flickers', () => {
    expect(transitionFx('spin', 0.5, 'out').rotate).toBeGreaterThan(30)
    expect(transitionFx('spin', 1, 'in').rotate).toBeCloseTo(0)
    const iris = transitionFx('iris', 0.5, 'in').wipe!
    expect([iris.dirX, iris.dirY]).toEqual([0, 0])
    expect(transitionFx('slideRight', 0, 'in').dx).toBeCloseTo(-1)
    expect(transitionFx('slideDown', 0, 'in').dy).toBeCloseTo(-1)
    // Exactly one of the two shots is visible at any moment of a glitch.
    for (let i = 0; i <= 20; i++) {
      const p = i / 20
      expect(transitionFx('glitch', p, 'out').opacity + transitionFx('glitch', p, 'in').opacity).toBe(1)
    }
  })
})
