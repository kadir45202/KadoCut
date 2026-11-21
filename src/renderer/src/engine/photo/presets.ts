import type { PhotoDevelop } from '@shared/photo'
import { defaultDevelop } from '@shared/photo'

/** Built-in looks. Like Lightroom presets they only set the values they list. */
export interface BuiltinPreset {
  id: 'vivid' | 'cinematic' | 'bw' | 'bwContrast' | 'vintage' | 'warm' | 'cool' | 'matte' | 'portrait' | 'landscape' | 'moody' | 'pastel'
  develop: Partial<PhotoDevelop>
}

const curve = (...pts: [number, number][]) => pts.map(([x, y]) => ({ x, y }))
const straight = () => curve([0, 0], [1, 1])
const wheel = (hue: number, sat: number, lum = 0) => ({ hue, sat, lum })
const bands = (values: Partial<Record<number, number>>) => Array.from({ length: 8 }, (_, i) => values[i] ?? 0)
const base = defaultDevelop()

export const BUILTIN_PRESETS: BuiltinPreset[] = [
  { id: 'vivid', develop: { contrast: 0.2, clarity: 0.15, vibrance: 0.35, saturation: 0.1 } },
  {
    id: 'cinematic',
    develop: {
      contrast: 0.15,
      highlights: -0.3,
      shadows: 0.2,
      saturation: -0.1,
      grading: { ...base.grading, shadows: wheel(190, 0.45), highlights: wheel(35, 0.4), balance: -0.1 },
      vignette: { amount: -0.2, midpoint: 0.5, feather: 0.6 }
    }
  },
  { id: 'bw', develop: { mono: true, contrast: 0.3, clarity: 0.2 } },
  { id: 'bwContrast', develop: { mono: true, contrast: 0.6, blacks: -0.3, whites: 0.3, clarity: 0.3, grain: { amount: 0.3, size: 0.3 } } },
  {
    id: 'vintage',
    develop: {
      temp: 0.2,
      saturation: -0.2,
      curves: { master: curve([0, 0.08], [0.5, 0.52], [1, 0.92]), r: straight(), g: straight(), b: straight() },
      grading: { ...base.grading, shadows: wheel(220, 0.25), highlights: wheel(45, 0.3) },
      grain: { amount: 0.35, size: 0.35 },
      vignette: { amount: -0.25, midpoint: 0.45, feather: 0.6 }
    }
  },
  { id: 'warm', develop: { temp: 0.3, tint: 0.05, vibrance: 0.15 } },
  { id: 'cool', develop: { temp: -0.3, highlights: -0.1, vibrance: 0.1 } },
  {
    id: 'matte',
    develop: { contrast: -0.1, saturation: -0.15, curves: { master: curve([0, 0.12], [0.25, 0.27], [0.75, 0.78], [1, 0.95]), r: straight(), g: straight(), b: straight() } }
  },
  {
    id: 'portrait',
    develop: {
      exposure: 0.15,
      texture: -0.2,
      clarity: -0.1,
      vibrance: 0.1,
      hsl: { hue: bands({}), sat: bands({ 1: -0.1 }), lum: bands({ 1: 0.15 }) },
      sharpen: { amount: 0.3, radius: 1, masking: 0.5 }
    }
  },
  {
    id: 'landscape',
    develop: { dehaze: 0.25, clarity: 0.25, vibrance: 0.3, hsl: { hue: bands({}), sat: bands({ 3: 0.15, 5: 0.2 }), lum: bands({ 5: -0.15 }) } }
  },
  { id: 'moody', develop: { exposure: -0.3, contrast: 0.2, highlights: -0.4, shadows: -0.1, temp: -0.2, saturation: -0.2, vignette: { amount: -0.35, midpoint: 0.45, feather: 0.6 } } },
  { id: 'pastel', develop: { exposure: 0.2, contrast: -0.25, highlights: 0.2, shadows: 0.3, saturation: -0.25, vibrance: 0.2 } }
]

/** Applies a preset's settings over the current ones (crop and masks are never touched by a preset). */
export function applyPreset(current: PhotoDevelop, preset: Partial<PhotoDevelop>): PhotoDevelop {
  const { crop: _crop, masks: _masks, ...rest } = preset
  return structuredClone({ ...current, ...rest, crop: current.crop, masks: current.masks })
}

/** True when nothing has been changed from the defaults (crop included). */
export function isDefaultDevelop(d: PhotoDevelop): boolean {
  return JSON.stringify(d) === JSON.stringify(defaultDevelop())
}

/** Stable short key of a develop state (thumbnail cache). */
export function developKey(d: PhotoDevelop): string {
  const s = JSON.stringify(d)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
