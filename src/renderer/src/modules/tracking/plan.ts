import type { Keyframe } from '@shared/project/schema'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface FaceTrack {
  /** Source seconds and box (fractions of the frame) per detection. */
  points: { t: number; box: Box }[]
}

const center = (b: Box) => [b.x + b.w / 2, b.y + b.h / 2] as const

/**
 * Links per-frame face boxes into tracks: a box continues the track whose last box is closest
 * (within a face width) and was seen recently; otherwise it starts a new track.
 */
export function linkFaces(frames: { t: number; faces: Box[] }[], maxGap: number): FaceTrack[] {
  const tracks: FaceTrack[] = []
  for (const frame of frames) {
    const used = new Set<FaceTrack>()
    for (const face of frame.faces) {
      const [cx, cy] = center(face)
      let best: FaceTrack | null = null
      let bestDist = Infinity
      for (const track of tracks) {
        const last = track.points[track.points.length - 1]
        if (used.has(track) || frame.t - last.t > maxGap) continue
        const [lx, ly] = center(last.box)
        const dist = Math.hypot(cx - lx, cy - ly)
        if (dist < Math.max(last.box.w, face.w) * 1.2 && dist < bestDist) {
          best = track
          bestDist = dist
        }
      }
      if (best) best.points.push({ t: frame.t, box: face })
      else tracks.push((best = { points: [{ t: frame.t, box: face }] }))
      used.add(best)
    }
  }
  return tracks
}

/** Keyframes from samples, thinned to at most one per `step` seconds (always keeping the last). */
export function samplesToKeys(samples: { t: number; v: number }[], step: number): Keyframe[] {
  const keys: Keyframe[] = []
  let next = -Infinity
  samples.forEach((s, i) => {
    if (s.t < next - 1e-6 && i !== samples.length - 1) return
    next = s.t + step
    if (keys.length && Math.abs(keys[keys.length - 1].t - s.t) < 1e-4) return
    keys.push({ t: Math.max(0, s.t), v: s.v, e: 'linear' })
  })
  return keys
}
