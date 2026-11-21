import type { Clip, CompoundClip, InnerClip, Project, Track, Transform } from '@shared/project/schema'
import { clipEnd, trimEnd, trimStart } from '@renderer/core/project/clip'

/** The compound a flattened clip came from (its transform applies on top of the clip's own). */
export interface ParentRef {
  id: string
  start: number
  duration: number
  transform: Transform
}

export type RenderClip = Clip & { parent?: ParentRef }

/** Id of the clip the user works with for a rendered clip (the compound for nested clips). */
export const ownerId = (clip: RenderClip) => clip.parent?.id ?? clip.id

const cache = new WeakMap<Project, Project>()

/** Inner clips of a compound, trimmed to its window and moved to timeline time. */
function flatten(p: Project, compound: CompoundClip, trackIds: Map<string, string>, out: Record<string, Clip>) {
  const from = compound.in
  const to = compound.in + compound.duration
  const fps = p.settings.fps
  const parent: ParentRef = { id: compound.id, start: compound.start, duration: compound.duration, transform: compound.transform }
  for (const inner of Object.values(compound.clips)) {
    if (clipEnd(inner) <= from + 1e-6 || inner.start >= to - 1e-6) continue
    let clip: InnerClip = inner
    if (clip.start < from) clip = trimStart(clip, from, fps) as InnerClip
    if (clipEnd(clip) > to) clip = trimEnd(clip, to, 'assetId' in clip ? p.assets[clip.assetId] : undefined, fps) as InnerClip
    const id = `${compound.id}/${inner.id}`
    const flat: RenderClip = { ...clip, id, trackId: trackIds.get(inner.trackId) ?? inner.trackId, start: compound.start + clip.start - from, parent }
    out[id] = flat
  }
}

/**
 * Rendering view of a project: compound clips are replaced by their (trimmed) inner clips on
 * virtual tracks stacked where the compound sits. Preview, export and the audio mixer all use
 * this view, so nested timelines need no special casing there. Cached per project object.
 */
export function expandCompounds(p: Project): Project {
  const hit = cache.get(p)
  if (hit) return hit
  const compounds = Object.values(p.clips).filter((c): c is CompoundClip => c.kind === 'compound')
  if (!compounds.length) {
    cache.set(p, p)
    return p
  }
  const clips: Record<string, Clip> = {}
  for (const c of Object.values(p.clips)) if (c.kind !== 'compound') clips[c.id] = c
  const tracks: Track[] = []
  for (const track of p.tracks) {
    tracks.push(track)
    for (const compound of compounds.filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)) {
      const ids = new Map<string, string>()
      for (const inner of compound.tracks) {
        const id = `${compound.id}/${inner.id}`
        ids.set(inner.id, id)
        tracks.push({ ...inner, id, main: false, hidden: inner.hidden || track.hidden, muted: inner.muted || track.muted || compound.muted })
      }
      flatten(p, compound, ids, clips)
    }
  }
  const view = { ...p, tracks, clips }
  cache.set(p, view)
  return view
}
