import type { Draft } from 'immer'
import type { Asset, Clip, Project, TrackKind } from '@shared/project/schema'
import { clipEnd, snapToFrame, trimEnd, trimStart } from '@renderer/core/project/clip'
import { addTrack, findOrCreateFreeTrack, isRangeFree, mainTrack, nearestSnap, trackKindFor } from '@renderer/core/project/timeline'

/** Where a dragged clip should land vertically. */
export type DropTarget = { kind: 'track'; trackId: string } | { kind: 'new'; trackKind: TrackKind }

export interface MoveParams {
  /** Snapshot of the project when the drag started. */
  origin: Project
  ids: string[]
  primaryId: string
  /** Pointer movement in seconds. */
  dt: number
  target: DropTarget | null
  snapPoints: number[] | null
  snapThreshold: number
}

export interface MoveResult {
  recipe: (draft: Draft<Project>) => void
  snappedAt: number | null
}

/** Clip order on the magnetic main track after inserting `id` at time `t`. */
function mainOrder(origin: Project, id: string, t: number): string[] {
  const main = mainTrack(origin)
  const others = Object.values(origin.clips)
    .filter((c) => c.trackId === main.id && c.id !== id)
    .sort((a, b) => a.start - b.start)
  const index = others.findIndex((c) => t < c.start + c.duration / 2)
  const ids = others.map((c) => c.id)
  ids.splice(index < 0 ? ids.length : index, 0, id)
  return ids
}

/**
 * Computes a move from the drag origin (never incrementally), so repeated pointer events are
 * idempotent and the result never drifts.
 */
export function computeMove(p: MoveParams): MoveResult {
  const { origin, ids, primaryId } = p
  const primary = origin.clips[primaryId]
  let dt = p.dt
  let snappedAt: number | null = null

  if (p.snapPoints) {
    const s1 = nearestSnap(primary.start + dt, p.snapPoints, p.snapThreshold)
    const s2 = nearestSnap(clipEnd(primary) + dt, p.snapPoints, p.snapThreshold)
    const d1 = s1 === null ? Infinity : Math.abs(s1 - (primary.start + dt))
    const d2 = s2 === null ? Infinity : Math.abs(s2 - (clipEnd(primary) + dt))
    if (s1 !== null && d1 <= d2) {
      dt = s1 - primary.start
      snappedAt = s1
    } else if (s2 !== null) {
      dt = s2 - clipEnd(primary)
      snappedAt = s2
    }
  }
  // Never move any selected clip before 0.
  const minStart = Math.min(...ids.map((id) => origin.clips[id].start))
  dt = Math.max(dt, -minStart)
  const fps = origin.settings.fps

  const targetId = p.target?.kind === 'track' ? p.target.trackId : null
  const targetTrack = targetId ? origin.tracks.find((t) => t.id === targetId) : undefined
  const verticalOk = ids.length === 1 && targetTrack && targetTrack.kind === trackKindFor(primary.kind) && !targetTrack.locked

  const recipe = (d: Draft<Project>) => {
    const draft = d as Project
    if (verticalOk && targetTrack!.main && draft.settings.magnetic) {
      // Insert into the main sequence; normalize() packs it.
      const order = mainOrder(origin, primaryId, primary.start + dt)
      draft.clips[primaryId].trackId = targetTrack!.id
      let cursor = 0
      for (const id of order) {
        draft.clips[id].start = cursor
        cursor += draft.clips[id].duration
      }
      return
    }
    for (const id of ids) {
      const c = draft.clips[id]
      c.start = snapToFrame(Math.max(0, origin.clips[id].start + dt), fps)
      if (id === primaryId && verticalOk) c.trackId = targetTrack!.id
    }
  }
  return { recipe, snappedAt }
}

/**
 * Final placement on drop: creates a requested new track and moves clips that would overlap
 * another clip to a free track (CapCut behaviour) instead of rejecting the edit.
 */
export function resolveDrop(draft: Project, ids: string[], primaryId: string, target: DropTarget | null) {
  if (target?.kind === 'new' && ids.length === 1) {
    const clip = draft.clips[primaryId]
    if (trackKindFor(clip.kind) === target.trackKind) clip.trackId = addTrack(draft, target.trackKind).id
  }
  const moving = new Set(ids)
  for (const id of ids) {
    const c = draft.clips[id]
    const track = draft.tracks.find((t) => t.id === c.trackId)!
    if (track.main && draft.settings.magnetic) continue
    const others = new Set([...moving].filter((x) => x !== id))
    if (!isRangeFree(draft, c.trackId, c.start, clipEnd(c), new Set([id, ...others]))) {
      c.trackId = findOrCreateFreeTrack(draft, track.kind, c.start, clipEnd(c), { preferId: c.trackId, exclude: new Set([id]) }).id
    }
  }
}

/** Dragging a clip's fade handle: fade length follows the pointer, up to half the clip. */
export function computeFade(origin: Project, id: string, edge: 'in' | 'out', dt: number): (draft: Draft<Project>) => void {
  const clip = origin.clips[id]
  if (clip.kind !== 'video' && clip.kind !== 'audio') return () => {}
  const max = Math.min(10, clip.duration / 2)
  const start = edge === 'in' ? clip.audio.fadeIn : clip.audio.fadeOut
  const value = Math.round(Math.min(max, Math.max(0, start + (edge === 'in' ? dt : -dt))) * 100) / 100
  return (d) => {
    const c = (d as Project).clips[id]
    if (c && (c.kind === 'video' || c.kind === 'audio')) c.audio[edge === 'in' ? 'fadeIn' : 'fadeOut'] = value
  }
}

export interface TrimParams {
  origin: Project
  id: string
  edge: 'start' | 'end'
  dt: number
  snapPoints: number[] | null
  snapThreshold: number
}

export function computeTrim(p: TrimParams): MoveResult {
  const clip = p.origin.clips[p.id]
  const asset: Asset | undefined = 'assetId' in clip ? p.origin.assets[clip.assetId] : undefined
  const fps = p.origin.settings.fps
  let edgeTime = (p.edge === 'start' ? clip.start : clipEnd(clip)) + p.dt
  let snappedAt: number | null = null
  if (p.snapPoints) {
    const s = nearestSnap(edgeTime, p.snapPoints, p.snapThreshold)
    if (s !== null) {
      edgeTime = s
      snappedAt = s
    }
  }
  edgeTime = snapToFrame(edgeTime, fps)
  // Trimming must not run into the neighbour on free tracks.
  const track = p.origin.tracks.find((t) => t.id === clip.trackId)!
  const magnetic = track.main && p.origin.settings.magnetic
  if (!magnetic) {
    const neighbours = Object.values(p.origin.clips).filter((c) => c.trackId === clip.trackId && c.id !== clip.id)
    if (p.edge === 'start') {
      const prevEnd = Math.max(0, ...neighbours.filter((c) => clipEnd(c) <= clip.start + 1e-6).map(clipEnd))
      edgeTime = Math.max(edgeTime, prevEnd)
    } else {
      const nextStart = Math.min(Infinity, ...neighbours.filter((c) => c.start >= clipEnd(clip) - 1e-6).map((c) => c.start))
      edgeTime = Math.min(edgeTime, nextStart)
    }
  }
  const next: Clip = p.edge === 'start' ? trimStart(clip, edgeTime, fps) : trimEnd(clip, edgeTime, asset, fps)
  return {
    recipe: (d) => {
      ;(d as Project).clips[p.id] = next
    },
    snappedAt
  }
}
