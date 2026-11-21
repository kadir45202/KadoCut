import type { AspectPreset, Project, ProjectSettings } from '@shared/project/schema'
import { ASPECT_PRESETS } from '@shared/project/defaults'
import { snapToFrame } from './clip'

export const FRAME_RATES = [24, 25, 30, 48, 50, 60]

/** Short-side sizes offered for every aspect ratio. */
export const SIZE_TIERS = [{ short: 720, label: '720p' }, { short: 1080, label: '1080p' }, { short: 1440, label: '2K' }, { short: 2160, label: '4K' }]

const even = (n: number) => Math.max(16, Math.round(n / 2) * 2)

export const shortSide = (s: Pick<ProjectSettings, 'width' | 'height'>) => Math.min(s.width, s.height)

/** Canvas size of an aspect ratio at a short-side size (positions and text scale with it). */
export function sizeFor(aspect: AspectPreset, short: number): { width: number; height: number } {
  const base = ASPECT_PRESETS[aspect]
  const k = short / Math.min(base.width, base.height)
  return { width: even(base.width * k), height: even(base.height * k) }
}

/** Changes the frame rate and moves every edit point onto the new frame grid. */
export function setFrameRate(draft: Project, fps: number) {
  draft.settings.fps = fps
  const snap = (t: number) => snapToFrame(t, fps)
  for (const c of Object.values(draft.clips)) {
    const end = snap(c.start + c.duration)
    c.start = snap(c.start)
    c.duration = Math.max(1 / fps, end - c.start)
  }
  for (const m of draft.markers) m.t = snap(m.t)
  if (draft.range) {
    draft.range.in = snap(draft.range.in)
    draft.range.out = Math.max(draft.range.in + 1 / fps, snap(draft.range.out))
  }
}
