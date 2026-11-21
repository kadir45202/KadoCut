import type { Project } from '@shared/project/schema'
import { clipEnd, trimEnd } from '@renderer/core/project/clip'
import { clipsOnTrack, mainTrack } from '@renderer/core/project/timeline'

/** Shortest clip the beat sync will produce (seconds). */
const MIN_CLIP = 0.25

/**
 * Re-times the main track so every cut lands on a beat: each clip ends on the beat nearest to
 * its current end (every `every`-th beat), as far as its source media allows. Returns how many
 * clips changed.
 */
export function alignToBeats(draft: Project, beats: number[], every: number): number {
  const grid = beats.filter((_, i) => i % every === 0)
  if (!grid.length) return 0
  const fps = draft.settings.fps
  let cursor = 0
  let changed = 0
  for (const clip of clipsOnTrack(draft, mainTrack(draft).id)) {
    const asset = 'assetId' in clip ? draft.assets[clip.assetId] : undefined
    // How far the clip could reach with its media (checked by trimming to "infinity").
    const longest = trimEnd({ ...clip, start: cursor }, cursor + 1e6, asset, fps).duration
    let best: number | null = null
    for (const b of grid) {
      if (b < cursor + MIN_CLIP || b - cursor > longest + 1e-6) continue
      if (best === null || Math.abs(b - (cursor + clip.duration)) < Math.abs(best - (cursor + clip.duration))) best = b
    }
    const target = draft.clips[clip.id]
    target.start = cursor
    if (best !== null && Math.abs(best - clipEnd(target)) > 1e-4) {
      target.duration = best - cursor
      changed++
    }
    cursor += target.duration
  }
  return changed
}
