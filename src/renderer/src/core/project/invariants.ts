import { type Clip, Project, type Track } from '@shared/project/schema'
import { clipEnd, isMediaClip } from './clip'
import { sourceSpan } from './speed'
import { trackKindFor } from './timeline'

const EPS = 1e-4

/**
 * Validates a project after an edit. Any violation rejects the edit, so a buggy tool can never
 * leave the project in a broken state. Returns an error message or null.
 */
export function validateProject(input: unknown): string | null {
  const parsed = Project.safeParse(input)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return `schema: ${i?.path.join('.')} ${i?.message}`
  }
  const p = parsed.data
  const mains = p.tracks.filter((t) => t.main)
  if (mains.length !== 1 || mains[0].kind !== 'video') return 'project must have exactly one main video track'

  return checkClips(p, p.tracks, p.clips, false)
}

/** Track membership, asset references and overlaps for one timeline level. */
function checkClips(p: Project, trackList: Track[], clips: Record<string, Clip>, inner: boolean): string | null {
  if (new Set(trackList.map((t) => t.id)).size !== trackList.length) return 'duplicate track id'
  const tracks = new Map(trackList.map((t) => [t.id, t]))
  const byTrack = new Map<string, { start: number; end: number; id: string }[]>()

  for (const [id, c] of Object.entries(clips)) {
    if (id !== c.id) return `clip key mismatch ${id}`
    const track = tracks.get(c.trackId)
    if (!track) return `clip ${id} is on a missing track`
    if (track.kind !== trackKindFor(c.kind)) return `clip ${id} (${c.kind}) cannot be on a ${track.kind} track`

    if (c.kind === 'compound') {
      if (inner) return `compound ${id} cannot be nested`
      if (!c.tracks.length) return `compound ${id} has no tracks`
      const error = checkClips(p, c.tracks, c.clips, true)
      if (error) return `compound ${id}: ${error}`
    }
    if ('assetId' in c) {
      const asset = p.assets[c.assetId]
      if (!asset) return `clip ${id} references a missing asset`
      if (c.kind === 'video' && asset.kind !== 'video') return `clip ${id} expects a video asset`
      if (c.kind === 'image' && asset.kind !== 'image') return `clip ${id} expects an image asset`
      if (c.kind === 'audio' && !asset.hasAudio) return `clip ${id} expects an asset with audio`
      if (isMediaClip(c) && asset.duration > 0) {
        if (c.in < -EPS) return `clip ${id} starts before its source`
        // One frame of tolerance for container duration rounding.
        if (c.in + sourceSpan(c.speed, c.duration) > asset.duration + 0.1) return `clip ${id} runs past the end of its source`
      }
      if ('bgRemoval' in c && c.bgRemoval.assetId && !p.assets[c.bgRemoval.assetId]) return `clip ${id} has a missing background render`
      if ('crop' in c && (c.crop.left + c.crop.right > 0.95 || c.crop.top + c.crop.bottom > 0.95)) return `clip ${id} is cropped away completely`
      if ('audio' in c && c.audio.denoise.assetId && !p.assets[c.audio.denoise.assetId]) return `clip ${id} has a missing denoise render`
    }
    if ('color' in c && c.color.lutAssetId && p.assets[c.color.lutAssetId]?.kind !== 'lut') return `clip ${id} references a missing LUT`
    const list = byTrack.get(c.trackId) ?? []
    list.push({ start: c.start, end: clipEnd(c), id })
    byTrack.set(c.trackId, list)
  }

  for (const list of byTrack.values()) {
    list.sort((a, b) => a.start - b.start)
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end - EPS) return `clips ${list[i - 1].id} and ${list[i].id} overlap`
    }
  }
  return null
}
