import type { CompoundClip, InnerClip, Project, Track } from '@shared/project/schema'
import { defaultTransform } from '@shared/project/defaults'
import { clipEnd, trimEnd, trimStart } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { findOrCreateFreeTrack, isRangeFree, mainTrack } from '@renderer/core/project/timeline'

/**
 * Nests clips into one compound clip ("nest" / "compound clip"). The compound sits on the
 * lowest video track of the selection; inner clips keep their tracks and relative timing.
 * Returns the new clip id, or an error key.
 */
export function groupClips(draft: Project, ids: string[], name: string): { id: string } | { error: 'nothing' | 'nested' | 'blocked' } {
  const clips = ids.map((id) => draft.clips[id]).filter(Boolean)
  if (clips.length < 2) return { error: 'nothing' }
  if (clips.some((c) => c.kind === 'compound')) return { error: 'nested' }
  const start = Math.min(...clips.map((c) => c.start))
  const end = Math.max(...clips.map(clipEnd))
  const used = new Set(clips.map((c) => c.trackId))
  const tracks = draft.tracks.filter((t) => used.has(t.id))
  const selected = new Set(ids)
  const host = tracks.find((t) => t.kind === 'video')
  if (host && !isRangeFree(draft, host.id, start, end, selected)) return { error: 'blocked' }

  const inner: Record<string, InnerClip> = {}
  for (const c of clips) {
    inner[c.id] = { ...(c as InnerClip), start: c.start - start }
    delete draft.clips[c.id]
  }
  const trackId = host?.id ?? findOrCreateFreeTrack(draft, 'video', start, end).id
  const compound: CompoundClip = {
    id: newId(),
    trackId,
    start,
    duration: end - start,
    name,
    kind: 'compound',
    in: 0,
    transform: defaultTransform(),
    muted: false,
    tracks: tracks.map((t): Track => ({ ...t, main: false })),
    clips: inner
  }
  draft.clips[compound.id] = compound
  return { id: compound.id }
}

/**
 * Puts a compound's clips back on the timeline (trimmed to what the compound showed), on their
 * original tracks when free. The compound's own transform is not baked in.
 */
export function ungroupClip(draft: Project, id: string): string[] {
  const compound = draft.clips[id]
  if (compound?.kind !== 'compound') return []
  delete draft.clips[id]
  const fps = draft.settings.fps
  const from = compound.in
  const to = compound.in + compound.duration
  const out: string[] = []
  const placed = new Map<string, string>()
  for (const inner of Object.values(compound.clips).sort((a, b) => a.start - b.start)) {
    if (clipEnd(inner) <= from + 1e-6 || inner.start >= to - 1e-6) continue
    let clip: InnerClip = inner
    if (clip.start < from) clip = trimStart(clip, from, fps) as InnerClip
    if (clipEnd(clip) > to) clip = trimEnd(clip, to, 'assetId' in clip ? draft.assets[clip.assetId] : undefined, fps) as InnerClip
    const start = compound.start + clip.start - from
    const end = start + clip.duration
    const kind = compound.tracks.find((t) => t.id === inner.trackId)?.kind ?? 'video'
    const prefer = placed.get(inner.trackId) ?? inner.trackId
    const track = findOrCreateFreeTrack(draft, kind, start, end, { preferId: prefer, allowMain: prefer === mainTrack(draft).id })
    placed.set(inner.trackId, track.id)
    const restored = { ...clip, id: draft.clips[clip.id] ? newId() : clip.id, trackId: track.id, start }
    draft.clips[restored.id] = restored
    out.push(restored.id)
  }
  return out
}
