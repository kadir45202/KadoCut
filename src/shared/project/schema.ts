import { z } from 'zod'

/**
 * Project file model — the single source of truth shared by main, renderer and export.
 * Every change that alters the persisted shape must bump PROJECT_SCHEMA_VERSION and add a
 * migration in ./migrate.ts.
 *
 * Units:
 *  - time: seconds (edits are snapped to the project frame grid)
 *  - position: fraction of canvas size, 0 = centered (x: of width, y: of height)
 *  - scale: 1 = media fits ("contain") the canvas
 *  - rotation: degrees, clockwise
 *  - volume: linear gain (1 = 0 dB)
 */
export const PROJECT_SCHEMA_VERSION = 4

const Id = z.string().min(1)
const Time = z.number().finite().min(0)

export const Easing = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'])

/** Keyframe time `t` is local to the clip (0 = clip start on the timeline). */
export const Keyframe = z.object({
  t: Time,
  v: z.number().finite(),
  e: Easing
})

/** A number that is either static (`keys` empty) or animated by keyframes. */
export const Animated = z.object({
  value: z.number().finite(),
  keys: z.array(Keyframe)
})

export const Transform = z.object({
  x: Animated,
  y: Animated,
  scale: Animated,
  rotation: Animated,
  opacity: Animated
})

export const SpeedPoint = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0.1).max(10)
})

export const Speed = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('constant'),
    rate: z.number().min(0.1).max(100),
    preservePitch: z.boolean()
  }),
  z.object({
    mode: z.literal('curve'),
    preset: z.string(),
    points: z.array(SpeedPoint).min(2)
  })
])

export const MaskType = z.enum(['none', 'linear', 'mirror', 'circle', 'rectangle', 'heart', 'star'])

/** Mask geometry is in the clip's own frame: cx/cy/width/height are fractions of the media size. */
export const Mask = z.object({
  type: MaskType,
  cx: z.number().finite(),
  cy: z.number().finite(),
  width: z.number().min(0.01).max(4),
  height: z.number().min(0.01).max(4),
  rotation: z.number().finite(),
  feather: z.number().min(0).max(1),
  roundness: z.number().min(0).max(1),
  invert: z.boolean()
})

/** Voice changer presets applied in the clip's audio chain. */
export const VoiceFx = z.enum(['none', 'telephone', 'radio', 'megaphone', 'echo', 'hall', 'robot', 'underwater'])

export const AudioProps = z.object({
  volume: Animated,
  muted: z.boolean(),
  fadeIn: Time,
  fadeOut: Time,
  /** True once the audio was detached to its own audio clip. */
  detached: z.boolean(),
  /** Lowers this clip while other clips contain speech (background music). */
  /** Three-band equaliser, gains in dB. */
  eq: z.object({
    enabled: z.boolean(),
    low: z.number().min(-24).max(24),
    mid: z.number().min(-24).max(24),
    high: z.number().min(-24).max(24)
  }),
  compressor: z.object({
    enabled: z.boolean(),
    /** dBFS */
    threshold: z.number().min(-60).max(0),
    ratio: z.number().min(1).max(20),
    /** Make-up gain in dB. */
    makeup: z.number().min(0).max(24)
  }),
  ducking: z.object({
    enabled: z.boolean(),
    /** Gain reduction while speech is present, in dB (negative). */
    amount: z.number().min(-40).max(0),
    /** 0..1 — higher reacts to quieter speech. */
    sensitivity: z.number().min(0).max(1)
  }),
  denoise: z.object({
    enabled: z.boolean(),
    strength: z.number().min(0).max(1),
    /** Processed audio asset; empty until the job finished. */
    assetId: z.string()
  }),
  voice: VoiceFx
})

/** Chroma key (green/blue screen) for overlays. */
export const ChromaKey = z.object({
  enabled: z.boolean(),
  color: z.string(),
  /** Colour distance treated as fully transparent (0..1). */
  similarity: z.number().min(0).max(1),
  /** Soft edge width above `similarity` (0..1). */
  smoothness: z.number().min(0).max(1),
  /** How much of the key colour is removed from edges (0..1). */
  spill: z.number().min(0).max(1)
})

export const TransitionType = z.enum([
  'dissolve', 'fadeBlack', 'fadeWhite', 'slideLeft', 'slideUp', 'push', 'zoomIn', 'zoomOut', 'whip', 'wipe',
  'slideRight', 'slideDown', 'spin', 'flash', 'glitch', 'iris'
])

/**
 * Transition from the previous adjacent clip on the same track into this clip, centred on the
 * cut. Clips keep their positions; where media runs out the edge frame is held.
 */
export const Transition = z.object({
  type: TransitionType,
  duration: z.number().min(0.1).max(3)
})

export const BlendMode = z.enum(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'softLight', 'difference'])

export const CurvePoint = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
const CurvePoints = z.array(CurvePoint).min(2).max(16)

/** Tone curves: master first, then each channel's own (identity = [(0,0), (1,1)]). */
export const Curves = z.object({ master: CurvePoints, r: CurvePoints, g: CurvePoints, b: CurvePoints })

/** Basic colour correction; 0 is neutral for every slider. */
export const ColorAdjust = z.object({
  /** Exposure in stops. */
  exposure: z.number().min(-3).max(3),
  contrast: z.number().min(-1).max(1),
  brightness: z.number().min(-1).max(1),
  saturation: z.number().min(-1).max(1),
  temperature: z.number().min(-1).max(1),
  highlights: z.number().min(-1).max(1),
  shadows: z.number().min(-1).max(1),
  /** LUT asset ('' for none). */
  lutAssetId: z.string(),
  lutIntensity: z.number().min(0).max(1),
  curves: Curves
})

/** Crop in the clip's displayed frame (fractions removed from each edge) plus mirroring. */
export const Crop = z.object({
  left: z.number().min(0).max(0.95),
  top: z.number().min(0).max(0.95),
  right: z.number().min(0).max(0.95),
  bottom: z.number().min(0).max(0.95),
  flipH: z.boolean(),
  flipV: z.boolean()
})

/** Camera-shake removal: the clip plays from a stabilized render of its media. */
export const Stabilize = z.object({
  enabled: z.boolean(),
  /** 0 = light smoothing, 1 = locked-off look. */
  strength: z.number().min(0).max(1),
  /** Stabilized asset; empty until the job finished. */
  assetId: z.string()
})

export const BackgroundRemoval = z.object({
  enabled: z.boolean(),
  /** Alpha video asset; empty until the job finished. */
  assetId: z.string()
})

export const TextStyle = z.object({
  fontFamily: z.string(),
  fontWeight: z.number().int().min(100).max(900),
  /** Font size as a fraction of canvas height. */
  fontSize: z.number().min(0.005).max(1),
  color: z.string(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().min(0.5).max(3),
  letterSpacing: z.number().min(-0.2).max(1),
  /** Max text box width as a fraction of canvas width. */
  maxWidth: z.number().min(0.05).max(1),
  uppercase: z.boolean(),
  strokeColor: z.string(),
  /** Stroke width as a fraction of font size; 0 disables. */
  strokeWidth: z.number().min(0).max(0.5),
  backgroundColor: z.string(),
  /** 0 disables the background box. */
  backgroundOpacity: z.number().min(0).max(1),
  shadow: z.boolean(),
  /** Color of the currently spoken word in captions. */
  highlightColor: z.string(),
  /** How the spoken word stands out: text colour, a box behind it, or colour + enlarge. */
  highlightMode: z.enum(['color', 'box', 'scale', 'none']),
  /** 'word': caption words appear only once they are spoken. */
  reveal: z.enum(['all', 'word'])
})

export const CaptionWord = z.object({
  text: z.string(),
  /** Clip-local seconds. */
  start: Time,
  end: Time
})

export const AnimIn = z.enum(['none', 'fade', 'pop', 'zoomIn', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'bounce', 'typewriter'])
export const AnimOut = z.enum(['none', 'fade', 'pop', 'zoomOut', 'slideUp', 'slideDown', 'slideLeft', 'slideRight'])
export const AnimLoop = z.enum(['none', 'pulse', 'wiggle', 'float', 'swing'])

/** Preset entrance / exit / looping motion layered on top of the clip's transform. */
export const ClipAnimation = z.object({
  in: z.object({ type: AnimIn, duration: z.number().min(0.05).max(5) }),
  out: z.object({ type: AnimOut, duration: z.number().min(0.05).max(5) }),
  loop: z.object({ type: AnimLoop, period: z.number().min(0.2).max(10) })
})

const ClipBase = {
  id: Id,
  trackId: Id,
  start: Time,
  duration: z.number().finite().positive(),
  name: z.string()
}

export const VideoClip = z.object({
  ...ClipBase,
  kind: z.literal('video'),
  assetId: Id,
  /** Source time (seconds) at the clip's first frame. */
  in: Time,
  speed: Speed,
  transform: Transform,
  mask: Mask,
  audio: AudioProps,
  bgRemoval: BackgroundRemoval,
  chroma: ChromaKey,
  transition: Transition.nullable(),
  blend: BlendMode,
  color: ColorAdjust,
  crop: Crop,
  anim: ClipAnimation,
  stabilize: Stabilize
})

export const ImageClip = z.object({
  ...ClipBase,
  kind: z.literal('image'),
  assetId: Id,
  transform: Transform,
  mask: Mask,
  bgRemoval: BackgroundRemoval,
  chroma: ChromaKey,
  transition: Transition.nullable(),
  blend: BlendMode,
  color: ColorAdjust,
  crop: Crop,
  anim: ClipAnimation
})

export const AudioClip = z.object({
  ...ClipBase,
  kind: z.literal('audio'),
  assetId: Id,
  in: Time,
  speed: Speed,
  audio: AudioProps
})

export const TextClip = z.object({
  ...ClipBase,
  kind: z.literal('text'),
  role: z.enum(['text', 'caption']),
  text: z.string(),
  style: TextStyle,
  transform: Transform,
  /** Word timings for caption highlighting (role = caption). */
  words: z.array(CaptionWord),
  anim: ClipAnimation
})

export const ShapeType = z.enum(['rectangle', 'ellipse', 'triangle', 'star', 'heart', 'arrow', 'line', 'progress'])

/** Vector graphic drawn by the app (stickers, call-outs, progress bar). */
export const ShapeClip = z.object({
  ...ClipBase,
  kind: z.literal('shape'),
  shape: ShapeType,
  /** Box size as fractions of the canvas width / height. */
  width: z.number().min(0.005).max(2),
  height: z.number().min(0.002).max(2),
  fill: z.string(),
  stroke: z.string(),
  /** Outline width as a fraction of the shorter side; 0 disables. */
  strokeWidth: z.number().min(0).max(0.5),
  /** Corner rounding (rectangle, progress), 0..1. */
  radius: z.number().min(0).max(1),
  /** Progress bar track colour. */
  secondary: z.string(),
  transform: Transform,
  anim: ClipAnimation
})

export const EffectType = z.enum([
  'none', 'blur', 'pixelate', 'vignette', 'grain', 'sharpen', 'rgbSplit', 'glitch', 'vhs', 'shake', 'zoomBlur',
  'zoomPulse', 'strobe', 'mirror', 'kaleido', 'split2', 'split3', 'split4', 'split9', 'invert', 'noir', 'sepia',
  'oldFilm', 'fisheye', 'glow', 'lightLeak', 'posterize', 'letterbox'
])

export const AdjustEffect = z.object({
  type: EffectType,
  amount: z.number().min(0).max(1)
})

/**
 * Applies colour correction / blur / pixelation to everything drawn below it. The layer is
 * canvas-sized; transform + mask limit the affected region (e.g. a tracked face blur).
 */
export const AdjustmentClip = z.object({
  ...ClipBase,
  kind: z.literal('adjustment'),
  transform: Transform,
  mask: Mask,
  color: ColorAdjust,
  effect: AdjustEffect
})

/** Clips that can live inside a compound clip (compounds do not nest). */
export const InnerClip = z.discriminatedUnion('kind', [VideoClip, ImageClip, AudioClip, TextClip, ShapeClip, AdjustmentClip])

export const Clip = z.discriminatedUnion('kind', [
  VideoClip,
  ImageClip,
  AudioClip,
  TextClip,
  ShapeClip,
  AdjustmentClip,
  z.object({
    ...ClipBase,
    kind: z.literal('compound'),
    /** Time inside the compound's own timeline at the clip's first frame. */
    in: Time,
    transform: Transform,
    muted: z.boolean(),
    /** Tracks / clips of the nested timeline, in compound-local time. */
    tracks: z.lazy(() => z.array(Track)),
    clips: z.record(z.string(), InnerClip)
  })
])

export const AssetKind = z.enum(['video', 'audio', 'image', 'lut'])

export const DerivedKind = z.enum(['freeze', 'nobg', 'denoise', 'tts', 'extract', 'sfx', 'stretch', 'stabilized', 'reversed'])

export const Asset = z.object({
  id: Id,
  kind: AssetKind,
  name: z.string(),
  /** Absolute path, or `./relative` inside the project folder. */
  path: z.string().min(1),
  duration: z.number().min(0),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
  fps: z.number().min(0),
  hasAudio: z.boolean(),
  hasVideo: z.boolean(),
  /** Internal helper media (e.g. alpha renders) are hidden from the media panel. */
  hidden: z.boolean(),
  derived: z
    .object({
      kind: DerivedKind,
      sourceAssetId: z.string(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    })
    .nullable(),
  /** Detected musical beats, in source seconds. */
  beats: z.array(z.number().min(0)),
  /** Whole-file speech transcript (source seconds), once transcribed. */
  transcript: z
    .object({
      language: z.string(),
      model: z.string(),
      words: z.array(z.object({ text: z.string(), start: Time, end: Time }))
    })
    .nullable()
})

export const TrackKind = z.enum(['video', 'audio', 'text'])

export const Track = z.object({
  id: Id,
  kind: TrackKind,
  /** The magnetic main video track (exactly one). */
  main: z.boolean(),
  muted: z.boolean(),
  hidden: z.boolean(),
  locked: z.boolean()
})

export const AspectPreset = z.enum(['9:16', '16:9', '1:1', '4:5'])

export const ProjectSettings = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  fps: z.number().min(1).max(240),
  aspect: AspectPreset,
  background: z.string(),
  /** Main track closes gaps automatically (CapCut-style). */
  magnetic: z.boolean(),
  /** Normalise the exported mix to a loudness target (LUFS). */
  loudness: z.object({ enabled: z.boolean(), target: z.number().min(-30).max(-5) })
})

export const MarkerColor = z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple'])

/** Timeline marker (also the source of YouTube chapters). */
export const Marker = z.object({
  id: Id,
  t: Time,
  label: z.string().max(200),
  color: MarkerColor
})

export const Project = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: Id,
  name: z.string().min(1).max(200),
  createdAt: z.number(),
  updatedAt: z.number(),
  settings: ProjectSettings,
  assets: z.record(z.string(), Asset),
  /** Visual tracks are stored in compositing order (index 0 is drawn first). */
  tracks: z.array(Track),
  clips: z.record(z.string(), Clip),
  markers: z.array(Marker),
  /** In / out points (I / O); export can render just this range. */
  range: z.object({ in: Time, out: Time }).nullable()
})

export type Easing = z.infer<typeof Easing>
export type Keyframe = z.infer<typeof Keyframe>
export type Animated = z.infer<typeof Animated>
export type Transform = z.infer<typeof Transform>
export type SpeedPoint = z.infer<typeof SpeedPoint>
export type Speed = z.infer<typeof Speed>
export type MaskType = z.infer<typeof MaskType>
export type Mask = z.infer<typeof Mask>
export type VoiceFx = z.infer<typeof VoiceFx>
export type AudioProps = z.infer<typeof AudioProps>
export type BackgroundRemoval = z.infer<typeof BackgroundRemoval>
export type Stabilize = z.infer<typeof Stabilize>
export type ChromaKey = z.infer<typeof ChromaKey>
export type TransitionType = z.infer<typeof TransitionType>
export type Transition = z.infer<typeof Transition>
export type BlendMode = z.infer<typeof BlendMode>
export type CurvePoint = z.infer<typeof CurvePoint>
export type Curves = z.infer<typeof Curves>
export type ColorAdjust = z.infer<typeof ColorAdjust>
export type Crop = z.infer<typeof Crop>
export type TextStyle = z.infer<typeof TextStyle>
export type AnimIn = z.infer<typeof AnimIn>
export type AnimOut = z.infer<typeof AnimOut>
export type AnimLoop = z.infer<typeof AnimLoop>
export type ClipAnimation = z.infer<typeof ClipAnimation>
export type ShapeType = z.infer<typeof ShapeType>
export type ShapeClip = z.infer<typeof ShapeClip>
export type EffectType = z.infer<typeof EffectType>
export type AdjustEffect = z.infer<typeof AdjustEffect>
export type AdjustmentClip = z.infer<typeof AdjustmentClip>
export type InnerClip = z.infer<typeof InnerClip>
export type CompoundClip = Extract<Clip, { kind: 'compound' }>
export type CaptionWord = z.infer<typeof CaptionWord>
export type VideoClip = z.infer<typeof VideoClip>
export type ImageClip = z.infer<typeof ImageClip>
export type AudioClip = z.infer<typeof AudioClip>
export type TextClip = z.infer<typeof TextClip>
export type Clip = z.infer<typeof Clip>
export type ClipKind = Clip['kind']
export type AssetKind = z.infer<typeof AssetKind>
export type DerivedKind = z.infer<typeof DerivedKind>
export type Asset = z.infer<typeof Asset>
export type TrackKind = z.infer<typeof TrackKind>
export type Track = z.infer<typeof Track>
export type AspectPreset = z.infer<typeof AspectPreset>
export type ProjectSettings = z.infer<typeof ProjectSettings>
export type Project = z.infer<typeof Project>
export type MarkerColor = z.infer<typeof MarkerColor>
export type Marker = z.infer<typeof Marker>

/** Lightweight info shown on the home screen. */
export interface ProjectSummary {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  duration: number
  aspect: AspectPreset
  width: number
  height: number
  clipCount: number
  dir: string
  /** media:// URL of the thumbnail, or null. */
  thumbnail: string | null
}
