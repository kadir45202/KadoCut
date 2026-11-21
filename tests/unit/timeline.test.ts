import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import type { Asset, Project } from '@shared/project/schema'
import { createEmptyProject } from '@shared/project/defaults'
import { migrateProject } from '@shared/project/migrate'
import { clipFromAsset } from '@renderer/core/project/factory'
import { validateProject } from '@renderer/core/project/invariants'
import { findOrCreateFreeTrack, nearestSnap, normalize, projectDuration } from '@renderer/core/project/timeline'

const asset: Asset = {
  id: 'a1',
  kind: 'video',
  name: 'v.mp4',
  path: 'C:/v.mp4',
  duration: 10,
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

function projectWithClips(starts: number[]): Project {
  const p = createEmptyProject({ id: 'p1aaaaaaaa', name: 'Test', aspect: '9:16', now: 1 })
  p.assets[asset.id] = asset
  for (const [i, s] of starts.entries()) {
    const c = clipFromAsset(asset, 'main', s)
    c.id = `c${i}`
    c.duration = 3
    p.clips[c.id] = c
  }
  return p
}

describe('timeline', () => {
  it('magnetic main track closes gaps', () => {
    const p = produce(projectWithClips([0, 5, 12]), (d) => normalize(d))
    expect(p.clips.c1.start).toBeCloseTo(3)
    expect(p.clips.c2.start).toBeCloseTo(6)
    expect(projectDuration(p)).toBeCloseTo(9)
  })

  it('overlay placement creates a new track when needed', () => {
    const p = produce(projectWithClips([0]), (d) => {
      const t1 = findOrCreateFreeTrack(d, 'video', 0, 2)
      const c = clipFromAsset(asset, t1.id, 0)
      c.duration = 2
      d.clips[c.id] = c
      const t2 = findOrCreateFreeTrack(d, 'video', 1, 3)
      expect(t2.id).not.toBe(t1.id)
    })
    expect(p.tracks.length).toBe(3)
  })

  it('validation rejects overlaps and wrong track kinds', () => {
    const p = projectWithClips([0, 1])
    expect(validateProject(p)).toMatch(/overlap/)
    const ok = produce(p, (d) => normalize(d))
    expect(validateProject(ok)).toBeNull()
    const bad = produce(ok, (d) => {
      d.tracks.push({ id: 'aud', kind: 'audio', main: false, muted: false, hidden: false, locked: false })
      d.clips.c0.trackId = 'aud'
    })
    expect(validateProject(bad)).toMatch(/cannot be on/)
  })

  it('validation rejects clips running past their source', () => {
    const p = produce(projectWithClips([0]), (d) => {
      d.clips.c0.duration = 30
    })
    expect(validateProject(p)).toMatch(/past the end/)
  })

  it('snaps to the nearest point within threshold', () => {
    expect(nearestSnap(2.04, [0, 2, 5], 0.1)).toBe(2)
    expect(nearestSnap(2.5, [0, 2, 5], 0.1)).toBeNull()
  })

  it('migration validates and rejects newer formats', () => {
    const p = projectWithClips([0])
    expect(migrateProject(JSON.parse(JSON.stringify(p))).id).toBe(p.id)
    expect(() => migrateProject({ ...p, schemaVersion: 99 })).toThrow(/newer/)
  })
})
