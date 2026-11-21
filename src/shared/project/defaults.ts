import type {
  Animated,
  AspectPreset,
  AudioProps,
  BackgroundRemoval,
  ChromaKey,
  ClipAnimation,
  ColorAdjust,
  Crop,
  Curves,
  Mask,
  MarkerColor,
  Project,
  ProjectSettings,
  Speed,
  Stabilize,
  TextStyle,
  Track,
  TrackKind,
  Transform
} from './schema'
import { PROJECT_SCHEMA_VERSION } from './schema'

export const ASPECT_PRESETS: Record<AspectPreset, { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 }
}

export const animated = (value: number): Animated => ({ value, keys: [] })

export const defaultTransform = (): Transform => ({
  x: animated(0),
  y: animated(0),
  scale: animated(1),
  rotation: animated(0),
  opacity: animated(1)
})

export const defaultMask = (): Mask => ({
  type: 'none',
  cx: 0,
  cy: 0,
  width: 0.6,
  height: 0.6,
  rotation: 0,
  feather: 0,
  roundness: 0,
  invert: false
})

export const defaultAudio = (): AudioProps => ({
  volume: animated(1),
  muted: false,
  fadeIn: 0,
  fadeOut: 0,
  detached: false,
  eq: { enabled: false, low: 0, mid: 0, high: 0 },
  compressor: { enabled: false, threshold: -24, ratio: 4, makeup: 6 },
  ducking: { enabled: false, amount: -12, sensitivity: 0.5 },
  denoise: { enabled: false, strength: 0.6, assetId: '' },
  voice: 'none'
})

export const defaultSpeed = (): Speed => ({ mode: 'constant', rate: 1, preservePitch: true })

export const defaultBgRemoval = (): BackgroundRemoval => ({ enabled: false, assetId: '' })

export const defaultStabilize = (): Stabilize => ({ enabled: false, strength: 0.5, assetId: '' })

const identity = () => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
]
export const defaultCurves = (): Curves => ({ master: identity(), r: identity(), g: identity(), b: identity() })

export const defaultColor = (): ColorAdjust => ({
  exposure: 0,
  contrast: 0,
  brightness: 0,
  saturation: 0,
  temperature: 0,
  highlights: 0,
  shadows: 0,
  lutAssetId: '',
  lutIntensity: 1,
  curves: defaultCurves()
})

export const defaultCrop = (): Crop => ({ left: 0, top: 0, right: 0, bottom: 0, flipH: false, flipV: false })

export const defaultAnim = (): ClipAnimation => ({
  in: { type: 'none', duration: 0.4 },
  out: { type: 'none', duration: 0.4 },
  loop: { type: 'none', period: 1.5 }
})

/** Look properties every video/image clip carries. */
export const defaultVisualProps = () => ({ transition: null, blend: 'normal' as const, color: defaultColor(), crop: defaultCrop(), anim: defaultAnim() })

export const defaultChroma = (): ChromaKey => ({ enabled: false, color: '#00FF00', similarity: 0.18, smoothness: 0.08, spill: 0.5 })

export const defaultTextStyle = (): TextStyle => ({
  fontFamily: 'Inter Variable',
  fontWeight: 700,
  fontSize: 0.045,
  color: '#FFFFFF',
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
  maxWidth: 0.85,
  uppercase: false,
  strokeColor: '#000000',
  strokeWidth: 0,
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  shadow: true,
  highlightColor: '#FFD60A',
  highlightMode: 'color',
  reveal: 'all'
})

export const captionTextStyle = (): TextStyle => ({
  ...defaultTextStyle(),
  fontWeight: 800,
  fontSize: 0.04,
  strokeWidth: 0.12,
  uppercase: true,
  maxWidth: 0.8
})

export const createTrack = (id: string, kind: TrackKind, main = false): Track => ({
  id,
  kind,
  main,
  muted: false,
  hidden: false,
  locked: false
})

export function projectSettingsFor(aspect: AspectPreset, fps = 30): ProjectSettings {
  return { ...ASPECT_PRESETS[aspect], fps, aspect, background: '#000000', magnetic: true, loudness: { enabled: false, target: -14 } }
}

/** Display colours of timeline markers. */
export const MARKER_COLORS: Record<MarkerColor, string> = {
  red: '#ff453a',
  orange: '#ff9f0a',
  yellow: '#ffd60a',
  green: '#30d158',
  blue: '#0a84ff',
  purple: '#bf5af2'
}

export function createEmptyProject(opts: {
  id: string
  name: string
  aspect: AspectPreset
  fps?: number
  now?: number
}): Project {
  const now = opts.now ?? Date.now()
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: opts.id,
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    settings: projectSettingsFor(opts.aspect, opts.fps),
    assets: {},
    tracks: [createTrack('main', 'video', true)],
    clips: {},
    markers: [],
    range: null
  }
}
