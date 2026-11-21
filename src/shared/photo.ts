import { z } from 'zod'
import { Curves } from './project/schema'

/**
 * Photo studio (Lightroom-style) catalog. Edits are non-destructive: each photo keeps a set of
 * develop settings next to a reference to the untouched original file.
 */
export const PHOTO_CATALOG_VERSION = 2

const unit = z.number().min(-1).max(1)
const pos = z.number().min(0).max(1)

/** The eight colour bands of the colour mixer, in hue order. */
export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const
export type HslBand = (typeof HSL_BANDS)[number]

const Band8 = z.array(unit).length(8)

export const GradeWheel = z.object({
  /** Degrees. */
  hue: z.number().min(0).max(360),
  sat: pos,
  /** Luminance offset. */
  lum: unit
})

export const CropAspect = z.enum(['free', 'original', '1:1', '4:5', '3:2', '16:9', '9:16'])

/** Most local adjustment masks a photo can have (one texture layer each). */
export const MAX_MASKS = 8

/** What a mask changes: offsets added to the global sliders where the mask is. */
export const LocalAdjust = z.object({
  exposure: z.number().min(-4).max(4),
  contrast: unit,
  highlights: unit,
  shadows: unit,
  clarity: unit,
  dehaze: unit,
  temp: unit,
  tint: unit,
  saturation: unit
})

/** One brush stroke; points are frame fractions [x0, y0, x1, y1…]. */
export const BrushStroke = z.object({
  /** Radius as a fraction of the photo's long edge. */
  size: z.number().min(0.002).max(0.5),
  feather: pos,
  erase: z.boolean(),
  points: z.array(z.number()).min(2)
})

const maskBase = { id: z.string().min(1), invert: z.boolean(), adjust: LocalAdjust }

/** Lightroom-style local adjustment masks. Positions are fractions of the (straightened) frame. */
export const PhotoMask = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('brush'), ...maskBase, strokes: z.array(BrushStroke) }),
  /** Full effect before (x0, y0), fading out until (x1, y1). */
  z.object({ kind: z.literal('linear'), ...maskBase, x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
  /** Ellipse; radii are fractions of the long edge, angle in degrees. */
  z.object({
    kind: z.literal('radial'),
    ...maskBase,
    cx: z.number(),
    cy: z.number(),
    rx: z.number().min(0.005).max(2),
    ry: z.number().min(0.005).max(2),
    angle: z.number().min(-180).max(180),
    feather: pos
  })
])

export const PhotoDevelop = z.object({
  /** White balance: blue ↔ yellow and green ↔ magenta. */
  temp: unit,
  tint: unit,
  /** Stops. */
  exposure: z.number().min(-5).max(5),
  contrast: unit,
  highlights: unit,
  shadows: unit,
  whites: unit,
  blacks: unit,
  texture: unit,
  clarity: unit,
  dehaze: unit,
  vibrance: unit,
  saturation: unit,
  curves: Curves,
  hsl: z.object({ hue: Band8, sat: Band8, lum: Band8 }),
  grading: z.object({
    shadows: GradeWheel,
    midtones: GradeWheel,
    highlights: GradeWheel,
    /** How much the three ranges overlap. */
    blending: pos,
    /** Moves the shadow / highlight split point. */
    balance: unit
  }),
  /** Amount goes to 150 % like Lightroom's. */
  sharpen: z.object({ amount: z.number().min(0).max(1.5), radius: z.number().min(0.5).max(3), masking: pos }),
  noise: z.object({ luminance: pos, color: pos }),
  vignette: z.object({ amount: unit, midpoint: pos, feather: pos }),
  grain: z.object({ amount: pos, size: pos }),
  /** Black & white treatment (the colour mixer's luminance sliders become the B&W mix). */
  mono: z.boolean(),
  /** Lens profile-style corrections (manual). */
  lens: z.object({ distortion: unit, vignette: unit, caRed: unit, caBlue: unit }),
  /** Perspective (keystone) correction and scale, Lightroom's Transform panel. */
  transform: z.object({ vertical: unit, horizontal: unit, scale: z.number().min(-0.5).max(0.5) }),
  masks: z.array(PhotoMask).max(MAX_MASKS),
  /**
   * Crop rectangle as fractions of the image, turned by `angle` around its centre. Turned, it lies
   * inside the photo; unturned it may reach past the edges, so the bounds are loose.
   */
  crop: z.object({
    x: z.number().min(-1).max(2),
    y: z.number().min(-1).max(2),
    w: z.number().min(0.001).max(2),
    h: z.number().min(0.001).max(2),
    angle: z.number().min(-45).max(45),
    aspect: CropAspect
  })
})

export const PhotoFlag = z.enum(['none', 'pick', 'reject'])

/** A named, saved state of a photo's settings (Lightroom snapshot). */
export const PhotoSnapshot = z.object({ id: z.string().min(1), name: z.string().min(1).max(60), at: z.number(), develop: PhotoDevelop })

export const Photo = z.object({
  id: z.string().min(1),
  /** Original file (never modified). */
  path: z.string().min(1),
  /** Browser-decodable copy for formats Chromium cannot read (TIFF, HEIC); empty when not needed. */
  preview: z.string(),
  name: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  addedAt: z.number(),
  rating: z.number().int().min(0).max(5),
  flag: PhotoFlag,
  develop: PhotoDevelop,
  /** Set on virtual copies: the photo this one was copied from. */
  copyOf: z.string(),
  snapshots: z.array(PhotoSnapshot).max(50)
})

export const PhotoPreset = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  /** Only the settings the preset changes. */
  develop: PhotoDevelop.partial()
})

export const PhotoCatalog = z.object({
  version: z.literal(PHOTO_CATALOG_VERSION),
  photos: z.array(Photo),
  presets: z.array(PhotoPreset)
})

export type GradeWheel = z.infer<typeof GradeWheel>
export type CropAspect = z.infer<typeof CropAspect>
export type LocalAdjust = z.infer<typeof LocalAdjust>
export type BrushStroke = z.infer<typeof BrushStroke>
export type PhotoMask = z.infer<typeof PhotoMask>
export type MaskKind = PhotoMask['kind']
export type PhotoSnapshot = z.infer<typeof PhotoSnapshot>
export type PhotoDevelop = z.infer<typeof PhotoDevelop>
export type PhotoFlag = z.infer<typeof PhotoFlag>
export type Photo = z.infer<typeof Photo>
export type PhotoPreset = z.infer<typeof PhotoPreset>
export type PhotoCatalog = z.infer<typeof PhotoCatalog>

const identity = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
]
const wheel = (): GradeWheel => ({ hue: 0, sat: 0, lum: 0 })
const zeros = () => [0, 0, 0, 0, 0, 0, 0, 0]

export const defaultDevelop = (): PhotoDevelop => ({
  temp: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
  curves: { master: identity(), r: identity(), g: identity(), b: identity() },
  hsl: { hue: zeros(), sat: zeros(), lum: zeros() },
  grading: { shadows: wheel(), midtones: wheel(), highlights: wheel(), blending: 0.5, balance: 0 },
  sharpen: { amount: 0.25, radius: 1, masking: 0 },
  noise: { luminance: 0, color: 0.25 },
  vignette: { amount: 0, midpoint: 0.5, feather: 0.5 },
  grain: { amount: 0, size: 0.25 },
  mono: false,
  lens: { distortion: 0, vignette: 0, caRed: 0, caBlue: 0 },
  transform: { vertical: 0, horizontal: 0, scale: 0 },
  masks: [],
  crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, aspect: 'original' }
})

export const defaultLocalAdjust = (): LocalAdjust => ({ exposure: 0, contrast: 0, highlights: 0, shadows: 0, clarity: 0, dehaze: 0, temp: 0, tint: 0, saturation: 0 })

/** Brings an older catalog file up to the current version (fills in settings added since). */
export function upgradeCatalog(raw: unknown): unknown {
  const c = raw as { version?: number; photos?: { develop?: object; snapshots?: unknown }[] } | null
  if (!c || typeof c !== 'object' || c.version !== 1) return raw
  const base = defaultDevelop()
  const fill = { lens: base.lens, transform: base.transform, masks: base.masks }
  return {
    ...c,
    version: 2,
    photos: (c.photos ?? []).map((p) => ({ ...p, develop: { ...fill, ...p.develop }, snapshots: p.snapshots ?? [] }))
  }
}

export const emptyCatalog = (): PhotoCatalog => ({ version: PHOTO_CATALOG_VERSION, photos: [], presets: [] })

/** Formats the photo studio imports; the last ones are converted to PNG for display. */
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif']
export const CONVERTED_PHOTO_EXTENSIONS = ['.tif', '.tiff', '.heic', '.heif']

/** What main reports for a file the user picked. */
export type PhotoProbe = { ok: true; path: string; preview: string; name: string; width: number; height: number } | { ok: false; path: string; error: string }
