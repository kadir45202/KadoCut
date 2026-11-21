import type { Clip, ClipKind, Project, Track, TrackKind } from '@shared/project/schema'
import { createTrack } from '@shared/project/defaults'
import { clipEnd, snapToFrame } from './clip'
import { localTimeForSourceOffset, sourceSpan } from './speed'

const EPS = 1e-6

/** Graphics (text, shapes) share text tracks; adjustment layers and compounds sit on video tracks. */
export const trackKindFor = (kind: ClipKind): TrackKind => (kind === 'audio' ? 'audio' : kind === 'text' || kind === 'shape' ? 'text' : 'video')

export function projectDuration(p: Project): number {
  let max = 0
  for (const c of Object.values(p.clips)) max = Math.max(max, clipEnd(c))
  return max
}

export function clipsOnTrack(p: Project, trackId: string): Clip[] {
  return Object.values(p.clips)
    .filter((c) => c.trackId === trackId)
    .sort((a, b) => a.start - b.start)
}

export const mainTrack = (p: Project): Track => p.tracks.find((t) => t.main)!

/** Tracks as shown top-to-bottom: visual tracks (top layer first), then audio tracks. */
export function displayTracks(p: Project): Track[] {
  const visual = p.tracks.filter((t) => t.kind !== 'audio').reverse()
  const audio = p.tracks.filter((t) => t.kind === 'audio')
  return [...visual, ...audio]
}

export function isRangeFree(p: Project, trackId: string, start: number, end: number, exclude: ReadonlySet<string> = new Set()): boolean {
  for (const c of Object.values(p.clips)) {
    if (c.trackId !== trackId || exclude.has(c.id)) continue
    if (start < clipEnd(c) - EPS && end > c.start + EPS) return false
  }
  return true
}

let trackCounter = 0
export const newTrackId = (kind: TrackKind) => `${kind}-${Date.now().toString(36)}-${(trackCounter++).toString(36)}`

/** Adds a track: visual tracks go on top of the stack, audio tracks at the bottom. */
export function addTrack(draft: Project, kind: TrackKind): Track {
  const track = createTrack(newTrackId(kind), kind)
  draft.tracks.push(track)
  return track
}

/** Finds a track of `kind` where [start, end) is free, preferring `preferId`; creates one if needed. */
export function findOrCreateFreeTrack(
  draft: Project,
  kind: TrackKind,
  start: number,
  end: number,
  opts: { preferId?: string; exclude?: ReadonlySet<string>; allowMain?: boolean } = {}
): Track {
  const candidates = draft.tracks.filter((t) => t.kind === kind && (opts.allowMain || !t.main) && !t.locked)
  const ordered = opts.preferId ? [...candidates.filter((t) => t.id === opts.preferId), ...candidates.filter((t) => t.id !== opts.preferId)] : candidates
  for (const t of ordered) if (isRangeFree(draft, t.id, start, end, opts.exclude)) return t
  return addTrack(draft, kind)
}

/** Magnetic main track: clips sit back-to-back from 0 in their current order. */
export function packMainTrack(draft: Project) {
  const main = mainTrack(draft)
  const clips = Object.values(draft.clips)
    .filter((c) => c.trackId === main.id)
    .sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const c of clips) {
    draft.clips[c.id].start = cursor
    cursor = snapToFrame(cursor + c.duration, draft.settings.fps)
    // Keep exact contiguity even if duration is not frame-aligned.
    cursor = Math.max(cursor, draft.clips[c.id].start + c.duration)
  }
}

/** Removes empty non-main tracks (CapCut-style tidy timeline). */
export function removeEmptyTracks(draft: Project) {
  const used = new Set(Object.values(draft.clips).map((c) => c.trackId))
  draft.tracks = draft.tracks.filter((t) => t.main || used.has(t.id))
}

/** Normalization run after every edit. */
export function normalize(draft: Project) {
  if (draft.settings.magnetic) packMainTrack(draft)
  removeEmptyTracks(draft)
}

/** Ripple: shifts every clip on `trackId` starting at/after `from` by `delta` seconds. */
export function rippleTrack(draft: Project, trackId: string, from: number, delta: number) {
  for (const c of Object.values(draft.clips)) {
    if (c.trackId === trackId && c.start >= from - EPS) c.start = Math.max(0, c.start + delta)
  }
}

/** Detected music beats of every clip that has them, in timeline time. */
export function beatPoints(p: Project): number[] {
  const out: number[] = []
  for (const c of Object.values(p.clips)) {
    if (c.kind !== 'audio' && c.kind !== 'video') continue
    const beats = p.assets[c.assetId]?.beats
    if (!beats?.length) continue
    const span = sourceSpan(c.speed, c.duration)
    for (const b of beats) if (b >= c.in && b <= c.in + span) out.push(c.start + localTimeForSourceOffset(c.speed, c.duration, b - c.in))
  }
  return out.sort((a, b) => a - b)
}

export function snapPoints(p: Project, playhead: number, exclude: ReadonlySet<string>): number[] {
  const points = [0, playhead, ...beatPoints(p), ...p.markers.map((m) => m.t)]
  for (const c of Object.values(p.clips)) {
    if (exclude.has(c.id)) continue
    points.push(c.start, clipEnd(c))
  }
  return points
}

/** Returns the nearest snap point within `threshold` seconds, or null. */
export function nearestSnap(t: number, points: readonly number[], threshold: number): number | null {
  let best: number | null = null
  let bestDist = threshold
  for (const p of points) {
    const d = Math.abs(p - t)
    if (d <= bestDist) {
      best = p
      bestDist = d
    }
  }
  return best
}

/** Clip at time t on a track (start inclusive, end exclusive). */
export function clipAt(p: Project, trackId: string, t: number): Clip | undefined {
  return Object.values(p.clips).find((c) => c.trackId === trackId && t >= c.start - EPS && t < clipEnd(c) - EPS)
}
