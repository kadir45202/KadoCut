import type { Project } from '@shared/project/schema'
import { clipEnd, snapToFrame, splitClip, type MediaClip } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { rippleTrack } from '@renderer/core/project/timeline'
import { localTimeForSourceOffset } from '@renderer/core/project/speed'

export interface SilenceOptions {
  /** Level below which audio counts as silence (dBFS). */
  thresholdDb: number
  /** Only pauses at least this long are removed (seconds). */
  minSilence: number
  /** Audio kept on each side of speech so words are not clipped (seconds). */
  padding: number
}

/**
 * Silent stretches (source seconds) within [from, to], from per-window peak levels
 * (`pps` windows per second). Pauses at the very start/end of the range are removed entirely.
 */
export function findSilences(peaks: Float32Array, pps: number, from: number, to: number, opts: SilenceOptions): [number, number][] {
  const threshold = 10 ** (opts.thresholdDb / 20)
  const i0 = Math.max(0, Math.floor(from * pps))
  const i1 = Math.min(peaks.length, Math.ceil(to * pps))
  const out: [number, number][] = []
  let run = -1
  for (let i = i0; i <= i1; i++) {
    const silent = i < i1 && peaks[i] < threshold
    if (silent && run < 0) run = i
    if (!silent && run >= 0) {
      const a = Math.max(from, run / pps)
      const b = Math.min(to, i / pps)
      if (b - a >= opts.minSilence) {
        const start = a <= from + 1e-6 ? from : a + opts.padding
        const end = b >= to - 1e-6 ? to : b - opts.padding
        if (end - start >= 0.05) out.push([start, end])
      }
      run = -1
    }
  }
  return out
}

/** Maps source-time ranges of a clip to timeline ranges (through trim and speed). */
export function toTimeline(clip: MediaClip, ranges: [number, number][]): [number, number][] {
  const at = (src: number) => clip.start + localTimeForSourceOffset(clip.speed, clip.duration, Math.max(0, src - clip.in))
  return ranges.map(([a, b]) => [at(a), at(b)])
}

export interface Removal {
  clipId: string
  /** Timeline ranges inside the clip. */
  ranges: [number, number][]
}

/**
 * Cuts the ranges out of their clips and closes the gaps (ripple). With `shiftOthers`, clips on
 * other tracks that come after a removed range move left too, so music/captions stay in sync.
 */
export function removeRanges(draft: Project, removals: Removal[], shiftOthers: boolean) {
  const fps = draft.settings.fps
  const cuts = removals
    .flatMap((r) => r.ranges.map(([a, b]) => ({ clipId: r.clipId, a: snapToFrame(a, fps), b: snapToFrame(b, fps) })))
    .filter((c) => c.b - c.a > 0.5 / fps)
    // Right to left, so earlier positions stay valid while we cut.
    .sort((x, y) => y.a - x.a)

  for (const { clipId, a, b } of cuts) {
    let clip = draft.clips[clipId]
    if (!clip) continue
    const trackId = clip.trackId
    if (b < clipEnd(clip) - 1e-6) {
      const parts = splitClip(clip, b, newId(), fps)
      if (parts) {
        draft.clips[parts[0].id] = parts[0]
        draft.clips[parts[1].id] = parts[1]
      }
    }
    clip = draft.clips[clipId]
    if (a > clip.start + 1e-6) {
      const parts = splitClip(clip, a, newId(), fps)
      if (parts) {
        draft.clips[parts[0].id] = parts[0]
        delete draft.clips[parts[1].id]
      }
    } else {
      delete draft.clips[clipId]
    }
    const length = b - a
    rippleTrack(draft, trackId, b, -length)
    if (shiftOthers) {
      for (const track of draft.tracks) if (track.id !== trackId) rippleTrack(draft, track.id, b, -length)
    }
  }
}
