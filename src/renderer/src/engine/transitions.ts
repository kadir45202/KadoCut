import type { ImageClip, Project, TransitionType, VideoClip } from '@shared/project/schema'
import { clipEnd } from '@renderer/core/project/clip'

/**
 * Transitions are centred on the cut between two adjacent clips of the same track. Neither clip
 * moves: the outgoing clip keeps playing past its end and the incoming one starts early (using
 * spare source media, or holding the edge frame when there is none).
 */

export const TRANSITION_TYPES: TransitionType[] = [
  'dissolve', 'fadeBlack', 'fadeWhite', 'flash', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'push', 'zoomIn', 'zoomOut',
  'spin', 'whip', 'glitch', 'wipe', 'iris'
]

type Visual = VideoClip | ImageClip
const isVisual = (c: unknown): c is Visual => !!c && ((c as Visual).kind === 'video' || (c as Visual).kind === 'image')

const EPS = 1e-3

export interface TransitionWindow {
  type: TransitionType
  from: Visual
  to: Visual
  start: number
  end: number
}

/** The clip that ends exactly where `clip` starts on the same track, if any. */
export function previousAdjacent(project: Project, clip: Visual): Visual | undefined {
  for (const c of Object.values(project.clips)) {
    if (c.id !== clip.id && c.trackId === clip.trackId && isVisual(c) && Math.abs(clipEnd(c) - clip.start) < EPS) return c
  }
  return undefined
}

/** The transition into `clip`, clamped so it never exceeds either clip. */
export function transitionInto(project: Project, clip: Visual): TransitionWindow | null {
  if (!clip.transition) return null
  const from = previousAdjacent(project, clip)
  if (!from) return null
  const d = Math.min(clip.transition.duration, from.duration, clip.duration)
  return { type: clip.transition.type, from, to: clip, start: clip.start - d / 2, end: clip.start + d / 2 }
}

/** The transition out of `clip` (into the next adjacent clip), if any. */
export function transitionOutOf(project: Project, clip: Visual): TransitionWindow | null {
  const end = clipEnd(clip)
  for (const c of Object.values(project.clips)) {
    if (c.id !== clip.id && c.trackId === clip.trackId && isVisual(c) && Math.abs(c.start - end) < EPS) return transitionInto(project, c)
  }
  return null
}

/** Timeline range in which a clip is drawn, including transition overlaps. */
export function visibleRange(project: Project, clip: Visual): [number, number] {
  const into = transitionInto(project, clip)
  const out = transitionOutOf(project, clip)
  return [into ? into.start : clip.start, out ? out.end : clipEnd(clip)]
}

export interface TransitionFx {
  opacity: number
  /** Offset in canvas fractions. */
  dx: number
  dy: number
  /** Scale multiplier about the layer centre. */
  scale: number
  /** Extra rotation about the layer centre, degrees. */
  rotate: number
  /** Screen-space wipe: visible where position along (dirX, dirY) is below `edge`; direction (0, 0) = circle from the centre. */
  wipe: { dirX: number; dirY: number; edge: number; feather: number } | null
  /** Horizontal motion blur length in canvas fractions. */
  blur: number
}

const NONE: TransitionFx = { opacity: 1, dx: 0, dy: 0, scale: 1, rotate: 0, wipe: null, blur: 0 }

/** Deterministic 0..1 noise per step, so preview and export glitch identically. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)
const easeStrong = (p: number) => (p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2)
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How the outgoing (`out`) or incoming (`in`) clip looks at progress p ∈ [0, 1] of a transition.
 */
export function transitionFx(type: TransitionType, p: number, role: 'out' | 'in'): TransitionFx {
  const e = ease(p)
  switch (type) {
    case 'dissolve':
      return role === 'in' ? { ...NONE, opacity: smooth(0, 1, p) } : NONE
    case 'fadeBlack':
    case 'fadeWhite':
      // The colour wash (frameFlash) hides the switch at the midpoint.
      return { ...NONE, opacity: role === 'out' ? (p < 0.5 ? 1 : 0) : p < 0.5 ? 0 : 1 }
    case 'slideLeft':
      return role === 'in' ? { ...NONE, dx: 1 - e } : NONE
    case 'slideUp':
      return role === 'in' ? { ...NONE, dy: 1 - e } : NONE
    case 'slideRight':
      return role === 'in' ? { ...NONE, dx: e - 1 } : NONE
    case 'slideDown':
      return role === 'in' ? { ...NONE, dy: e - 1 } : NONE
    case 'spin':
      return role === 'out'
        ? { ...NONE, rotate: 90 * e, scale: 1 - 0.4 * e, opacity: 1 - smooth(0.35, 0.65, p) }
        : { ...NONE, rotate: -90 * (1 - e), scale: 0.6 + 0.4 * e, opacity: smooth(0.35, 0.65, p) }
    case 'flash':
      // Hard cut under a white flash (frameFlash), the new shot settling from a small punch-in.
      return role === 'out' ? { ...NONE, opacity: p < 0.5 ? 1 : 0 } : { ...NONE, opacity: p < 0.5 ? 0 : 1, scale: 1 + 0.12 * (1 - smooth(0.5, 1, p)) }
    case 'glitch': {
      const step = Math.floor(p * 14)
      // Around the cut the two shots flicker and jump sideways.
      const flip = p > 0.2 && p < 0.8 && hash(step) > 0.55
      const showOut = p < 0.5 !== flip
      const shake = Math.sin(Math.PI * p)
      const jitter = (hash(step + (role === 'out' ? 17 : 41)) - 0.5) * 0.12 * shake
      return { ...NONE, opacity: (role === 'out') === showOut ? 1 : 0, dx: jitter, blur: 0.06 * shake * hash(step + 7) }
    }
    case 'iris':
      return role === 'in' ? { ...NONE, wipe: { dirX: 0, dirY: 0, edge: 1.04 * e, feather: 0.015 } } : NONE
    case 'push':
      return { ...NONE, dx: role === 'out' ? -e : 1 - e }
    case 'zoomIn':
      return role === 'out'
        ? { ...NONE, scale: 1 + 0.6 * e, opacity: 1 - smooth(0.3, 0.7, p) }
        : { ...NONE, scale: 0.6 + 0.4 * e, opacity: smooth(0.3, 0.7, p) }
    case 'zoomOut':
      return role === 'out'
        ? { ...NONE, scale: 1 - 0.4 * e, opacity: 1 - smooth(0.3, 0.7, p) }
        : { ...NONE, scale: 1.6 - 0.6 * e, opacity: smooth(0.3, 0.7, p) }
    case 'whip': {
      const s = easeStrong(p)
      // Blur follows the speed of the move: strongest mid-way.
      const blur = 0.35 * Math.sin(Math.PI * p) ** 2
      return { ...NONE, dx: role === 'out' ? -s : 1 - s, blur }
    }
    case 'wipe':
      return role === 'in' ? { ...NONE, wipe: { dirX: 1, dirY: 0, edge: -0.02 + 1.04 * e, feather: 0.02 } } : NONE
  }
}

/** Full-frame colour wash for fade-through transitions active at time t. */
export function frameFlash(project: Project, t: number): { color: string; amount: number } | null {
  let flash: { color: string; amount: number } | null = null
  for (const c of Object.values(project.clips)) {
    if (!isVisual(c) || !c.transition || !['fadeBlack', 'fadeWhite', 'flash'].includes(c.transition.type)) continue
    const track = project.tracks.find((tr) => tr.id === c.trackId)
    if (!track || track.hidden) continue
    const w = transitionInto(project, c)
    if (!w || t < w.start || t >= w.end) continue
    const p = (t - w.start) / (w.end - w.start)
    // A flash peaks sharply at the cut; fades ramp through the whole transition.
    const amount = w.type === 'flash' ? Math.exp(-Math.abs(p - 0.5) * 9) : smooth(0, 1, 1 - Math.abs(2 * p - 1))
    if (!flash || amount > flash.amount) flash = { color: w.type === 'fadeBlack' ? '#000000' : '#FFFFFF', amount }
  }
  return flash
}
