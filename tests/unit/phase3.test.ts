import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import type { Asset, CompoundClip, Project, TextClip, VideoClip } from '@shared/project/schema'
import { createEmptyProject, defaultAnim, defaultTransform } from '@shared/project/defaults'
import { migrateProject } from '@shared/project/migrate'
import { clipFromAsset, textClip } from '@renderer/core/project/factory'
import { validateProject } from '@renderer/core/project/invariants'
import { animAt } from '@renderer/engine/anim'
import { expandCompounds } from '@renderer/engine/expand'
import { integratedLoudness, normalizeLoudness } from '@renderer/engine/loudness'
import { evaluateFrame, layerFor } from '@renderer/engine/scene'
import { detectBeats } from '@renderer/modules/beats/detect'
import { alignToBeats } from '@renderer/modules/beats/sync'
import { groupClips, ungroupClip } from '@renderer/modules/compound/group'
import { planReframe } from '@renderer/modules/reframe/plan'
import { BUILTIN_TEMPLATES } from '@renderer/features/home/builtinTemplates'
import { comboOf, formatCombo } from '@renderer/core/modules/shortcuts'
import { isFiller, removalsFor, transcriptWords } from '@renderer/modules/transcript/words'

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

function project(): Project {
  const p = createEmptyProject({ id: 'p3aaaaaaaa', name: 'T', aspect: '16:9', now: 1 })
  p.assets[asset.id] = asset
  const c = clipFromAsset(asset, 'main', 0) as VideoClip
  c.id = 'c0'
  c.duration = 10
  p.clips.c0 = c
  return p
}

describe('schema v3 migration', () => {
  it('adds animation, highlight, audio effects, beats and loudness', () => {
    const v2 = JSON.parse(JSON.stringify(project()))
    v2.schemaVersion = 2
    delete v2.clips.c0.anim
    delete v2.clips.c0.audio.eq
    delete v2.clips.c0.audio.compressor
    delete v2.assets.a1.beats
    delete v2.assets.a1.transcript
    delete v2.settings.loudness
    const p = migrateProject(v2)
    expect(p.schemaVersion).toBe(4)
    expect((p.clips.c0 as VideoClip).anim.in.type).toBe('none')
    expect((p.clips.c0 as VideoClip).audio.eq.enabled).toBe(false)
    expect(p.assets.a1.beats).toEqual([])
    expect(p.settings.loudness.target).toBe(-14)
  })
})

describe('clip animations', () => {
  const anim = { ...defaultAnim(), in: { type: 'fade' as const, duration: 1 }, out: { type: 'slideLeft' as const, duration: 1 } }
  it('fades in and slides out', () => {
    expect(animAt(anim, 0, 5).opacity).toBeCloseTo(0)
    expect(animAt(anim, 0.5, 5).opacity).toBeCloseTo(0.5)
    expect(animAt(anim, 2.5, 5)).toMatchObject({ opacity: 1, dx: 0 })
    expect(animAt(anim, 4.999, 5).dx).toBeLessThan(-0.15)
  })
  it('typewriter reveals characters over the entrance', () => {
    const p = produce(project(), (d) => {
      const tc = textClip('main', 0, 'Merhaba dünya')
      tc.id = 't'
      tc.anim.in = { type: 'typewriter', duration: 1 }
      d.tracks.push({ id: 'tx', kind: 'text', main: false, muted: false, hidden: false, locked: false })
      tc.trackId = 'tx'
      d.clips.t = tc
    })
    const half = layerFor(p, p.clips.t as TextClip, 0.5)!
    expect(half.textState!.chars).toBe(6)
    expect(layerFor(p, p.clips.t as TextClip, 2)!.textState!.chars).toBe(Infinity)
  })
  it('caption words reveal as they are spoken', () => {
    const tc = { ...textClip('tx', 0, 'bir iki üç', 'caption'), words: [{ text: 'bir', start: 0, end: 0.5 }, { text: 'iki', start: 0.5, end: 1 }, { text: 'üç', start: 1, end: 1.5 }] }
    tc.style = { ...tc.style, reveal: 'word' }
    const p = produce(project(), (d) => {
      d.tracks.push({ id: 'tx', kind: 'text', main: false, muted: false, hidden: false, locked: false })
      d.clips[tc.id] = tc
    })
    const st = layerFor(p, p.clips[tc.id] as TextClip, 0.7)!.textState!
    expect(st).toMatchObject({ highlight: 1, revealed: 2 })
  })
})

describe('text-based editing', () => {
  const withTranscript = produce(project(), (d) => {
    d.assets.a1.transcript = {
      language: 'tr',
      model: 'base',
      words: [
        { text: 'Merhaba,', start: 0.2, end: 0.6 },
        { text: 'eee', start: 0.8, end: 1.3 },
        { text: 'bugün', start: 1.6, end: 2.0 },
        { text: 'yani', start: 2.1, end: 2.4 },
        { text: 'başlıyoruz.', start: 2.5, end: 3.2 }
      ]
    }
  })

  it('detects hesitations, optionally soft fillers', () => {
    expect(isFiller('Eeee...', 'tr', false)).toBe(true)
    expect(isFiller('Iıı', 'tr', false)).toBe(true)
    expect(isFiller('yani', 'tr', false)).toBe(false)
    expect(isFiller('yani', 'tr', true)).toBe(true)
    expect(isFiller('Um,', 'en', false)).toBe(true)
    expect(isFiller('bugün', 'tr', true)).toBe(false)
  })

  it('cuts a word together with the pause after it', () => {
    const words = transcriptWords(withTranscript)
    expect(words.map((w) => w.text)).toHaveLength(5)
    const removals = removalsFor(withTranscript, words, new Set([words[1].key]))
    expect(removals).toHaveLength(1)
    const [a, b] = removals[0].ranges[0]
    expect(a).toBeGreaterThanOrEqual(0.6)
    expect(a).toBeLessThan(0.8)
    expect(b).toBeLessThanOrEqual(1.6)
    expect(b).toBeGreaterThan(1.3)
  })
})

describe('compound clips', () => {
  const p = produce(project(), (d) => {
    const inner = d.clips.c0 as VideoClip
    delete d.clips.c0
    const compound: CompoundClip = {
      id: 'g',
      trackId: 'main',
      start: 0,
      duration: 4,
      name: 'Grup',
      kind: 'compound',
      in: 2,
      transform: { ...defaultTransform(), x: { value: 0.25, keys: [] }, scale: { value: 0.5, keys: [] } },
      muted: false,
      tracks: [{ id: 'main', kind: 'video', main: true, muted: false, hidden: false, locked: false }],
      clips: { c0: { ...inner, start: 0, duration: 10 } }
    }
    d.clips.g = compound
  })

  it('is a valid project', () => {
    expect(validateProject(p)).toBeNull()
  })

  it('flattens inner clips trimmed to the window, with the parent transform applied', () => {
    const view = expandCompounds(p)
    const flat = view.clips['g/c0'] as VideoClip
    expect(flat.start).toBe(0)
    expect(flat.duration).toBeCloseTo(4)
    expect(flat.in).toBeCloseTo(2)
    const [layer] = evaluateFrame(view, 1)
    // Half size, centred a quarter canvas width to the right.
    expect(layer.matrix[0]).toBeCloseTo(0.5)
    expect(layer.matrix[4]).toBeCloseTo(1920 / 2 + 480 - 480)
  })
})

describe('loudness', () => {
  const sine = (amp: number, seconds = 3) => Float32Array.from({ length: 48000 * seconds }, (_, i) => amp * Math.sin((2 * Math.PI * 1000 * i) / 48000))

  it('measures a -20 dBFS stereo sine at about -20 LUFS', () => {
    expect(integratedLoudness([sine(0.1), sine(0.1)], 48000)).toBeCloseTo(-20, 0)
  })

  it('normalises to the target and keeps peaks under -1 dBFS', () => {
    const ch = [sine(0.05), sine(0.05)]
    normalizeLoudness(ch, 48000, -6)
    const peak = ch[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(peak).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6)
  })
})

describe('auto reframe', () => {
  const clip = { ...(clipFromAsset(asset, 'main', 0) as VideoClip), duration: 4 }
  const frames = Array.from({ length: 12 }, (_, i) => ({ t: i / 3, faces: [{ x: 0.7, y: 0.3, w: 0.1, h: 0.2, score: 0.9 }] }))

  it('fills a vertical canvas and pans to the face', () => {
    const plan = planReframe(clip, asset, { width: 1080, height: 1920 }, frames, 3, 1)
    expect(plan.scale.value).toBeCloseTo(1920 / 1080 / (1080 / 1920))
    // Face centre at 0.75 of a 3413 px wide picture → shifted left by a quarter of it.
    expect(plan.x.value * 1080).toBeCloseTo(-0.25 * 1920 * (1080 / 1920) * plan.scale.value, 0)
    expect(plan.y.value).toBeCloseTo(0)
  })

  it('never pans past the picture edge', () => {
    const edge = frames.map((f) => ({ ...f, faces: [{ ...f.faces[0], x: 0.98, w: 0.02 }] }))
    const plan = planReframe(clip, asset, { width: 1080, height: 1920 }, edge, 3, 1)
    const shown = 1920 * (1080 / 1920) * plan.scale.value
    expect(-plan.x.value * 1080).toBeLessThanOrEqual((shown - 1080) / 2 + 1e-6)
  })
})

describe('beat detection', () => {
  it('finds the beats of a 120 BPM click track', () => {
    const rate = 48000
    const mono = new Float32Array(rate * 10)
    // Short decaying noise bursts every 0.5 s starting at 0.25 s.
    let seed = 1
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
    for (let b = 0.25; b < 10; b += 0.5) for (let i = 0; i < 2400; i++) mono[Math.round(b * rate) + i] = rand() * Math.exp(-i / 400)
    const { beats, bpm } = detectBeats(mono, rate)
    expect(bpm).toBeGreaterThan(115)
    expect(bpm).toBeLessThan(125)
    const inside = beats.filter((t) => t > 1 && t < 9)
    expect(inside.length).toBeGreaterThanOrEqual(15)
    for (const t of inside) expect(Math.abs(((t - 0.25) % 0.5 + 0.5) % 0.5 - (((t - 0.25) % 0.5 + 0.5) % 0.5 > 0.25 ? 0.5 : 0))).toBeLessThan(0.04)
  })
})

describe('grouping and beat sync', () => {
  const twoClips = () =>
    produce(project(), (d) => {
      ;(d.clips.c0 as VideoClip).duration = 3
      const b = { ...(d.clips.c0 as VideoClip), id: 'c1', start: 3, in: 5 }
      d.clips.c1 = b
      const tc = textClip('tx', 1, 'Başlık')
      tc.id = 't'
      d.tracks.push({ id: 'tx', kind: 'text', main: false, muted: false, hidden: false, locked: false })
      d.clips.t = tc
    })

  it('groups and ungroups without changing what is shown', () => {
    let id = ''
    const grouped = produce(twoClips(), (d) => {
      const r = groupClips(d as Project, ['c0', 'c1', 't'], 'G')
      if ('id' in r) id = r.id
    })
    expect(validateProject(grouped)).toBeNull()
    expect(Object.keys(grouped.clips)).toEqual([id])
    expect(evaluateFrame(expandCompounds(grouped), 3.5).map((l) => l.clip.id)).toEqual([`${id}/c1`, `${id}/t`])
    const back = produce(grouped, (d) => void ungroupClip(d as Project, id))
    expect(validateProject(back)).toBeNull()
    expect(back.clips.c1.start).toBe(3)
    expect(back.clips.c1.trackId).toBe('main')
    expect(back.clips.t.start).toBe(1)
  })

  it('moves cuts onto the nearest beats', () => {
    const p = produce(twoClips(), (d) => void alignToBeats(d as Project, [0.5, 1, 2.6, 3.4, 5.9, 6.5], 1))
    expect(p.clips.c0.duration).toBeCloseTo(2.6)
    expect(p.clips.c1.start).toBeCloseTo(2.6)
    expect(p.clips.c1.start + p.clips.c1.duration).toBeCloseTo(5.9)
  })
})

describe('templates and shortcuts', () => {
  it('every built-in template builds a valid project', () => {
    for (const tpl of BUILTIN_TEMPLATES) {
      const p = createEmptyProject({ id: `tpl-${tpl.id}`.toLowerCase().slice(0, 20).padEnd(8, 'x'), name: tpl.id, aspect: tpl.aspect, now: 1 })
      tpl.fill(p, (k) => k)
      expect(validateProject(p), tpl.id).toBeNull()
      expect(Object.keys(p.clips).length).toBeGreaterThan(1)
    }
  })

  it('formats key combos for menus', () => {
    expect(formatCombo('mod+shift+g')).toBe('Ctrl+Shift+G')
    expect(comboOf({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: 'K' })).toBe('mod+k')
  })
})
