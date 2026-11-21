import type { AdjustmentClip, Asset, AudioClip, Clip, ImageClip, ShapeClip, TextClip, VideoClip } from '@shared/project/schema'
import {
  captionTextStyle,
  defaultAnim,
  defaultAudio,
  defaultBgRemoval,
  defaultStabilize,
  defaultChroma,
  defaultColor,
  defaultMask,
  defaultSpeed,
  defaultTextStyle,
  defaultTransform,
  defaultVisualProps
} from '@shared/project/defaults'
import { nanoid } from 'nanoid'

export const newId = () => nanoid(12)

export const IMAGE_DEFAULT_DURATION = 3
export const TEXT_DEFAULT_DURATION = 3

/** Default clip for an asset dropped on the timeline. */
export function clipFromAsset(asset: Asset, trackId: string, start: number): Clip {
  const base = { id: newId(), trackId, start, name: asset.name }
  if (asset.kind === 'image') {
    const clip: ImageClip = {
      ...base,
      kind: 'image',
      assetId: asset.id,
      duration: IMAGE_DEFAULT_DURATION,
      transform: defaultTransform(),
      mask: defaultMask(),
      bgRemoval: defaultBgRemoval(),
      chroma: defaultChroma(),
      ...defaultVisualProps()
    }
    return clip
  }
  if (asset.kind === 'audio') {
    const clip: AudioClip = { ...base, kind: 'audio', assetId: asset.id, duration: asset.duration, in: 0, speed: defaultSpeed(), audio: defaultAudio() }
    return clip
  }
  const clip: VideoClip = {
    ...base,
    kind: 'video',
    assetId: asset.id,
    duration: asset.duration,
    in: 0,
    speed: defaultSpeed(),
    transform: defaultTransform(),
    mask: defaultMask(),
    audio: { ...defaultAudio(), muted: !asset.hasAudio },
    bgRemoval: defaultBgRemoval(),
    stabilize: defaultStabilize(),
    chroma: defaultChroma(),
    ...defaultVisualProps()
  }
  return clip
}

export function textClip(trackId: string, start: number, text: string, role: TextClip['role'] = 'text'): TextClip {
  return {
    id: newId(),
    trackId,
    start,
    duration: TEXT_DEFAULT_DURATION,
    name: text.slice(0, 40),
    kind: 'text',
    role,
    text,
    style: role === 'caption' ? captionTextStyle() : defaultTextStyle(),
    transform: role === 'caption' ? { ...defaultTransform(), y: { value: 0.3, keys: [] } } : defaultTransform(),
    words: [],
    anim: defaultAnim()
  }
}

export const SHAPE_DEFAULT_DURATION = 3

/** Shape sized for the canvas: width as a fraction of it, height from the shape's pixel aspect. */
export function shapeClip(trackId: string, start: number, shape: ShapeClip['shape'], canvas: { width: number; height: number }): ShapeClip {
  // [width fraction, height / width in pixels]
  const size: Record<ShapeClip['shape'], [number, number]> = {
    rectangle: [0.4, 0.35],
    ellipse: [0.25, 1],
    triangle: [0.25, 0.87],
    star: [0.25, 1],
    heart: [0.25, 0.9],
    arrow: [0.35, 0.4],
    line: [0.5, 0.02],
    progress: [1, 0.012]
  }
  const [w, aspect] = size[shape]
  const h = shape === 'progress' ? aspect : (w * canvas.width * aspect) / canvas.height
  return {
    id: newId(),
    trackId,
    start,
    duration: SHAPE_DEFAULT_DURATION,
    name: shape,
    kind: 'shape',
    shape,
    width: w,
    height: h,
    fill: shape === 'progress' ? '#FFFFFF' : '#FFD60A',
    stroke: '#000000',
    strokeWidth: 0,
    radius: shape === 'rectangle' ? 0.3 : 1,
    secondary: '#5A5A5E',
    // The progress bar hugs the bottom edge.
    transform: shape === 'progress' ? { ...defaultTransform(), y: { value: 0.5 - h / 2, keys: [] } } : defaultTransform(),
    anim: defaultAnim()
  }
}

export function adjustmentClip(trackId: string, start: number): AdjustmentClip {
  return {
    id: newId(),
    trackId,
    start,
    duration: 5,
    name: 'Adjustment',
    kind: 'adjustment',
    transform: defaultTransform(),
    mask: defaultMask(),
    color: defaultColor(),
    effect: { type: 'none', amount: 0.5 }
  }
}
