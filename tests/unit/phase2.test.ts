import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import type { Asset, Project, VideoClip } from '@shared/project/schema'
import { createEmptyProject } from '@shared/project/defaults'
import { migrateProject } from '@shared/project/migrate'
import { clipFromAsset } from '@renderer/core/project/factory'
import { normalize, projectDuration } from '@renderer/core/project/timeline'
import { validateProject } from '@renderer/core/project/invariants'
import { duckEnvelope } from '@renderer/engine/audio'
import { parseCube } from '@renderer/engine/lut'
import { evaluateFrame, extendedSourceTime } from '@renderer/engine/scene'
import { frameFlash, transitionFx, transitionInto, visibleRange } from '@renderer/engine/transitions'
import { cropForRatio } from '@renderer/modules/crop/ratio'
import { findSilences, removeRanges, toTimeline } from '@renderer/modules/silence/detect'

const asset: Asset = {
  id: 'a1',
  kind: 'video',
  name: 'v.mp4',
  path: 'C:/v.mp4',
  duration: 20,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  hidden: false,
  derived: null,
  beats: [],
  transcript: null
}

/** Main track with back-to-back 4 s clips taken from source time 5 s. */
function project(count = 2): Project {
  const p = createEmptyProject({ id: 'p2aaaaaaaa', name: 'T', aspect: '16:9', now: 1 })
  p.assets[asset.id] = asset
  for (let i = 0; i < count; i++) {
    const c = clipFromAsset(asset, 'main', i * 4) as VideoClip
    c.id = `c${i}`
    c.in = 5
    c.duration = 4
    p.clips[c.id] = c
  }
  return p
}

describe('schema migration', () => {
  it('fills new fields on v1 projects', () => {
    const v1 = JSON.parse(JSON.stringify(project()))
    v1.schemaVersion = 1
    for (const c of Object.values(v1.clips) as Record<string, unknown>[]) {
      delete c.transition
      delete c.blend
      delete c.color
      delete c.crop
      delete (c.audio as Record<string, unknown>).ducking
    }
    const p = migrateProject(v1)
    expect(p.schemaVersion).toBe(4)
    const c = p.clips.c0 as VideoClip
    expect(c.blend).toBe('normal')
    expect(c.transition).toBeNull()
    expect(c.color.exposure).toBe(0)
    expect(c.audio.ducking.enabled).toBe(false)
  })
})

describe('transitions', () => {
  const withDissolve = produce(project(), (d) => {
    ;(d.clips.c1 as VideoClip).transition = { type: 'dissolve', duration: 1 }
  })

  it('centres the window on the cut and extends both clips', () => {
    const w = transitionInto(withDissolve, withDissolve.clips.c1 as VideoClip)!
    expect(w.start).toBeCloseTo(3.5)
    expect(w.end).toBeCloseTo(4.5)
    expect(visibleRange(withDissolve, withDissolve.clips.c0 as VideoClip)).toEqual([0, 4.5])
    expect(visibleRange(withDissolve, withDissolve.clips.c1 as VideoClip)).toEqual([3.5, 8])
  })

  it('draws both clips during the transition, incoming on top', () => {
    const layers = evaluateFrame(withDissolve, 4.0)
    expect(layers.map((l) => l.clip.id)).toEqual(['c0', 'c1'])
    expect(layers[1].opacity).toBeGreaterThan(0.3)
    expect(layers[1].opacity).toBeLessThan(0.7)
    expect(evaluateFrame(withDissolve, 5).map((l) => l.clip.id)).toEqual(['c1'])
  })

  it('keeps playing the outgoing source past its out point', () => {
    const c0 = withDissolve.clips.c0 as VideoClip
    expect(extendedSourceTime(c0, 4.25, 20)).toBeCloseTo(9.25)
    // No media left: hold the last frame instead of running past the file.
    expect(extendedSourceTime({ ...c0, in: 16 }, 4.5, 20)).toBeLessThan(20)
  })

  it('effects run from start to end state', () => {
    expect(transitionFx('dissolve', 0, 'in').opacity).toBeCloseTo(0)
    expect(transitionFx('dissolve', 1, 'in').opacity).toBeCloseTo(1)
    expect(transitionFx('push', 1, 'out').dx).toBeCloseTo(-1)
    expect(transitionFx('push', 0, 'in').dx).toBeCloseTo(1)
    expect(transitionFx('wipe', 1, 'in').wipe!.edge).toBeGreaterThan(1)
  })

  it('fade-through flashes peak at the cut', () => {
    const p = produce(project(), (d) => {
      ;(d.clips.c1 as VideoClip).transition = { type: 'fadeWhite', duration: 1 }
    })
    expect(frameFlash(p, 4)?.amount).toBeCloseTo(1, 1)
    expect(frameFlash(p, 4)?.color).toBe('#FFFFFF')
    expect(frameFlash(p, 2)).toBeNull()
  })
})

describe('silence remover', () => {
  // 100 windows/s: speech 0–1 s, silence 1–2 s, speech 2–3 s.
  const peaks = new Float32Array(300).map((_, i) => (i >= 100 && i < 200 ? 0.001 : 0.5))

  it('finds pauses and keeps padding around speech', () => {
    const ranges = findSilences(peaks, 100, 0, 3, { thresholdDb: -40, minSilence: 0.5, padding: 0.1 })
    expect(ranges).toHaveLength(1)
    expect(ranges[0][0]).toBeCloseTo(1.1)
    expect(ranges[0][1]).toBeCloseTo(1.9)
  })

  it('ignores pauses shorter than the minimum', () => {
    expect(findSilences(peaks, 100, 0, 3, { thresholdDb: -40, minSilence: 1.5, padding: 0 })).toHaveLength(0)
  })

  it('cuts and closes the gap, shifting other tracks', () => {
    const base = project(1)
    const music = produce(base, (d) => {
      d.tracks.push({ id: 'aud', kind: 'audio', main: false, muted: false, hidden: false, locked: false })
      const a = clipFromAsset({ ...asset, id: 'm', kind: 'audio' }, 'aud', 3.5)
      a.id = 'music'
      a.duration = 0.5
      d.assets.m = { ...asset, id: 'm', kind: 'audio' }
      d.clips.music = a
    })
    const clip = music.clips.c0 as VideoClip
    const timeline = toTimeline(clip, [[6, 7]]) // source 6–7 s = timeline 1–2 s
    expect(timeline[0][0]).toBeCloseTo(1)
    const next = produce(music, (d) => {
      removeRanges(d as Project, [{ clipId: 'c0', ranges: timeline }], true)
      normalize(d as Project)
    })
    expect(validateProject(next)).toBeNull()
    expect(projectDuration(next)).toBeCloseTo(3)
    expect(next.clips.music.start).toBeCloseTo(2.5)
  })
})

describe('auto ducking', () => {
  it('rises under speech and releases after it', () => {
    const rate = 50
    const levels = new Float32Array(200).map((_, i) => (i >= 50 && i < 100 ? 0.3 : 0))
    const env = duckEnvelope(levels, rate, 0.5)
    expect(env[20]).toBeLessThan(0.05)
    expect(env[80]).toBeGreaterThan(0.9)
    expect(env[190]).toBeLessThan(0.1)
  })
})

describe('LUT and crop', () => {
  it('parses a .cube file and normalises its domain', () => {
    const cube = ['TITLE "x"', 'LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...Array.from({ length: 8 }, (_, i) => `${i & 1 ? 2 : 0} ${i & 2 ? 2 : 0} ${i & 4 ? 2 : 0}`)].join('\n')
    const lut = parseCube(cube)
    expect(lut.size).toBe(2)
    expect(Array.from(lut.data.slice(-3))).toEqual([1, 1, 1])
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/Expected 8/)
  })

  it('crops to an aspect ratio around the centre', () => {
    const c = cropForRatio(1920, 1080, 9 / 16)
    expect(c.top).toBe(0)
    expect(1 - c.left - c.right).toBeCloseTo((1080 * 9) / 16 / 1920)
  })
})
