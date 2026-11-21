import type { Animated, Asset, AudioClip, Clip, Speed, TextClip, Transform, VideoClip } from '@shared/project/schema'
import { scaleAnimated, shiftAnimated, splitAnimated } from './keyframes'
import { averageRate, durationForSpan, sourceOffsetAt, sourceSpan, subCurve } from './speed'

export type MediaClip = VideoClip | AudioClip

export const isMediaClip = (c: Clip): c is MediaClip => c.kind === 'video' || c.kind === 'audio'
export const hasTransform = (c: Clip): c is Exclude<Clip, AudioClip> => c.kind !== 'audio'
export const clipEnd = (c: Clip) => c.start + c.duration

export const frameDuration = (fps: number) => 1 / fps
export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps

/** Source range [in, out) a media clip plays. */
export function sourceRange(c: MediaClip): [number, number] {
  return [c.in, c.in + sourceSpan(c.speed, c.duration)]
}

/** Source time (seconds in the media file) shown at absolute timeline time t. */
export function sourceTimeAt(c: MediaClip, t: number): number {
  const local = Math.min(Math.max(t - c.start, 0), c.duration)
  return c.in + sourceOffsetAt(c.speed, c.duration, local)
}

function mapTransform(t: Transform, fn: (a: Animated) => Animated): Transform {
  return { x: fn(t.x), y: fn(t.y), scale: fn(t.scale), rotation: fn(t.rotation), opacity: fn(t.opacity) }
}

/** Applies fn to every animated property of a clip. */
export function mapAnimated<C extends Clip>(clip: C, fn: (a: Animated) => Animated): C {
  const next: Clip = { ...clip }
  if ('transform' in next) next.transform = mapTransform(next.transform, fn)
  if ('audio' in next) next.audio = { ...next.audio, volume: fn(next.audio.volume) }
  return next as C
}

function splitTransform(t: Transform, at: number): [Transform, Transform] {
  const parts = (['x', 'y', 'scale', 'rotation', 'opacity'] as const).map((k) => splitAnimated(t[k], at))
  const build = (i: 0 | 1): Transform => ({ x: parts[0][i], y: parts[1][i], scale: parts[2][i], rotation: parts[3][i], opacity: parts[4][i] })
  return [build(0), build(1)]
}

function splitSpeed(speed: Speed, u: number): [Speed, Speed] {
  if (speed.mode === 'constant') return [speed, speed]
  return [
    { ...speed, points: subCurve(speed.points, 0, u) },
    { ...speed, points: subCurve(speed.points, u, 1) }
  ]
}

/**
 * Splits a clip at absolute time `at` (already frame-snapped). Returns null when the cut would
 * leave a part shorter than one frame.
 */
export function splitClip(clip: Clip, at: number, rightId: string, fps: number): [Clip, Clip] | null {
  const local = at - clip.start
  const minLen = frameDuration(fps) - 1e-6
  if (local < minLen || clip.duration - local < minLen) return null

  const left: Clip = { ...clip, duration: local }
  const right: Clip = { ...clip, id: rightId, start: at, duration: clip.duration - local }

  if ('transform' in clip && 'transform' in left && 'transform' in right) {
    ;[left.transform, right.transform] = splitTransform(clip.transform, local)
  }
  if ('audio' in clip && 'audio' in left && 'audio' in right) {
    const [vl, vr] = splitAnimated(clip.audio.volume, local)
    left.audio = { ...clip.audio, volume: vl, fadeOut: 0 }
    right.audio = { ...clip.audio, volume: vr, fadeIn: 0 }
  }
  if (isMediaClip(clip) && isMediaClip(left) && isMediaClip(right)) {
    const u = local / clip.duration
    right.in = clip.in + sourceOffsetAt(clip.speed, clip.duration, local)
    ;[left.speed, right.speed] = splitSpeed(clip.speed, u)
  }
  if (clip.kind === 'compound' && right.kind === 'compound') right.in = clip.in + local
  if (clip.kind === 'text' && left.kind === 'text' && right.kind === 'text' && clip.words.length) {
    left.words = clip.words.filter((w) => w.start < local).map((w) => ({ ...w, end: Math.min(w.end, local) }))
    right.words = clip.words.filter((w) => w.end > local).map((w) => ({ ...w, start: Math.max(0, w.start - local), end: w.end - local }))
    left.text = left.words.map((w) => w.text).join(' ')
    right.text = right.words.map((w) => w.text).join(' ')
  }
  return [left, right]
}

/** Length of a compound's nested timeline. */
export const compoundLength = (c: Extract<Clip, { kind: 'compound' }>) => Object.values(c.clips).reduce((m, x) => Math.max(m, clipEnd(x)), 0)

/** Longest timeline duration a media clip may have (source availability), or Infinity. */
function maxDurationFrom(clip: Clip, asset: Asset | undefined, inPoint: number): number {
  if (clip.kind === 'compound') return Math.max(0, compoundLength(clip) - inPoint)
  if (!isMediaClip(clip) || !asset || asset.duration <= 0) return Infinity
  return durationForSpan(clip.speed, Math.max(0, asset.duration - inPoint))
}

/**
 * Moves the clip's start edge to `newStart`, keeping its end fixed. Media clips cannot reach
 * before source time 0. Returns the adjusted clip (clamped).
 */
export function trimStart(clip: Clip, newStart: number, fps: number): Clip {
  const end = clipEnd(clip)
  const minLen = frameDuration(fps)
  let start = Math.min(newStart, end - minLen)
  start = Math.max(0, start)

  if (isMediaClip(clip)) {
    const avg = averageRate(clip.speed)
    const sourceEnd = clip.in + sourceSpan(clip.speed, clip.duration)
    // Earliest start allowed by source time 0.
    start = Math.max(start, end - sourceEnd / avg)
    const duration = end - start
    const delta = clip.start - start
    const shifted = mapAnimated(clip, (a) => shiftAnimated(a, delta))
    return { ...shifted, start, duration, in: Math.max(0, sourceEnd - duration * avg) }
  }
  if (clip.kind === 'compound') start = Math.max(start, clip.start - clip.in)
  const delta = clip.start - start
  const shifted = mapAnimated(clip, (a) => shiftAnimated(a, delta))
  if (shifted.kind === 'compound') shifted.in = Math.max(0, clip.kind === 'compound' ? clip.in - delta : 0)
  if (shifted.kind === 'text' && shifted.words.length) {
    shifted.words = shifted.words.map((w) => ({ ...w, start: Math.max(0, w.start + delta), end: Math.max(0, w.end + delta) })).filter((w) => w.end > 0)
  }
  return { ...shifted, start, duration: end - start }
}

/** Moves the clip's end edge to `newEnd`, keeping its start fixed. */
export function trimEnd(clip: Clip, newEnd: number, asset: Asset | undefined, fps: number): Clip {
  const minLen = frameDuration(fps)
  let duration = Math.max(minLen, newEnd - clip.start)
  if (isMediaClip(clip) || clip.kind === 'compound') duration = Math.min(duration, maxDurationFrom(clip, asset, clip.in))
  return { ...clip, duration }
}

/**
 * Changes speed while keeping the same source material: duration, keyframes and fades scale.
 */
export function withSpeed<C extends MediaClip>(clip: C, speed: Speed): C {
  const span = sourceSpan(clip.speed, clip.duration)
  const duration = Math.max(1e-3, durationForSpan(speed, span))
  const factor = duration / clip.duration
  const scaled = mapAnimated(clip, (a) => scaleAnimated(a, factor))
  return {
    ...scaled,
    speed,
    duration,
    audio: { ...scaled.audio, fadeIn: scaled.audio.fadeIn * factor, fadeOut: scaled.audio.fadeOut * factor }
  }
}

/** Visible text of a clip at local time t (captions highlight the active word). */
export function activeWordIndex(clip: TextClip, local: number): number {
  for (let i = 0; i < clip.words.length; i++) if (local >= clip.words[i].start && local < clip.words[i].end) return i
  return -1
}

/** New word timings after caption text changes: keep timings when the word count matches. */
export function retimeWords(clip: TextClip, text: string): TextClip['words'] {
  const words = text.split(/\s+/).filter(Boolean)
  if (!clip.words.length) return []
  if (words.length === clip.words.length) return clip.words.map((w, i) => ({ ...w, text: words[i] }))
  const step = clip.duration / Math.max(1, words.length)
  return words.map((w, i) => ({ text: w, start: i * step, end: (i + 1) * step }))
}
