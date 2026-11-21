import type {
  AdjustEffect,
  AdjustmentClip,
  Asset,
  CompoundClip,
  BlendMode,
  ChromaKey,
  ColorAdjust,
  Crop,
  Curves,
  ImageClip,
  Mask,
  Project,
  ShapeClip,
  TextClip,
  Transform,
  VideoClip
} from '@shared/project/schema'
import { activeWordIndex, clipEnd, sourceTimeAt } from '@renderer/core/project/clip'
import { evalAnimated } from '@renderer/core/project/keyframes'
import { rateAt } from '@renderer/core/project/speed'
import { animAt, NO_ANIM, type AnimFx } from './anim'
import type { ParentRef, RenderClip } from './expand'
import { curvesNeutral } from './curves'
import { progressAt, shapeSize } from './shapes'
import { layoutText, type TextLayout, type TextState } from './text'
import { transitionFx, transitionInto, transitionOutOf, visibleRange, type TransitionFx } from './transitions'

/**
 * Evaluates which visual layers are on screen at time t and where. Pure: shared by preview,
 * export and viewer overlays (hit-testing / handles), which keeps all three in agreement.
 */

export type VisualClip = (VideoClip | ImageClip | TextClip | ShapeClip | AdjustmentClip) & { parent?: ParentRef }

export const isVisual = (c: RenderClip): c is VisualClip => c.kind !== 'audio' && c.kind !== 'compound'

export interface VisualLayer {
  /** Compounds only get layers for viewer overlays (they render through their inner clips). */
  clip: VisualClip | CompoundClip
  /** Clip-local time (clamped to the clip). */
  local: number
  /** Source time for video clips (may run past the clip edges during transitions). */
  sourceTime: number
  /** Asset providing pixels (the alpha render when background removal is on). */
  asset: Asset | null
  /** True when `asset` is a background-removed render with an alpha channel. */
  alpha: boolean
  /** Intrinsic size in pixels (text: laid-out box in canvas pixels). */
  width: number
  height: number
  text: TextLayout | null
  /** Visible part of a text clip (caption progress, typewriter). */
  textState: TextState | null
  /** Filled share of a progress bar shape. */
  progress: number
  /** Screen effect of an adjustment layer (it reads what is drawn below it). */
  effect: AdjustEffect | null
  /** Canvas-pixel affine transform of the media quad: [a, b, c, d, e, f] (like DOMMatrix). */
  matrix: [number, number, number, number, number, number]
  opacity: number
  mask: Mask | null
  chroma: ChromaKey | null
  crop: Crop | null
  /** Colour correction, null when neutral. */
  color: ColorAdjust | null
  /** Tone curves, null when they are all straight. */
  curves: Curves | null
  lutPath: string | null
  lutIntensity: number
  blend: BlendMode
  wipe: TransitionFx['wipe']
  /** Motion blur vector in canvas pixels. */
  blur: { x: number; y: number } | null
}

const EPS = 1e-6

/** Effects whose look does not depend on the amount slider (split gaps may be 0). */
export const effectNeedsAmount = (type: AdjustEffect['type']) => !['mirror', 'kaleido', 'split2', 'split3', 'split4', 'split9'].includes(type)

/** Asset whose pixels a clip shows (alpha render when background removal is ready, else the stabilized render). */
export function pixelSource(project: Project, clip: VideoClip | ImageClip): { asset: Asset | null; alpha: boolean } {
  const base = project.assets[clip.assetId] ?? null
  if (clip.bgRemoval.enabled && clip.bgRemoval.assetId) {
    const nobg = project.assets[clip.bgRemoval.assetId]
    if (nobg) return { asset: nobg, alpha: true }
  }
  if (clip.kind === 'video' && clip.stabilize.enabled && clip.stabilize.assetId) {
    const steady = project.assets[clip.stabilize.assetId]
    if (steady) return { asset: steady, alpha: false }
  }
  return { asset: base, alpha: false }
}

/** Source time at timeline time t, continuing past the clip edges at the edge speed. */
export function extendedSourceTime(clip: VideoClip, t: number, mediaDuration: number): number {
  const local = t - clip.start
  if (local >= 0 && local <= clip.duration) return sourceTimeAt(clip, t)
  const before = local < 0
  const edge = before ? clip.in : sourceTimeAt(clip, clipEnd(clip))
  const rate = rateAt(clip.speed, clip.duration, before ? 0 : clip.duration)
  const extra = before ? local : local - clip.duration
  const max = mediaDuration > 0 ? mediaDuration - 1e-3 : Infinity
  return Math.min(max, Math.max(0, edge + extra * rate))
}

const isNeutral = (c: ColorAdjust) =>
  !c.exposure && !c.contrast && !c.brightness && !c.saturation && !c.temperature && !c.highlights && !c.shadows

const isFullCrop = (c: Crop) => !c.left && !c.top && !c.right && !c.bottom && !c.flipH && !c.flipV

/** Canvas-pixel matrix for a box of `width`×`height` drawn at `fit` scale with a transform. */
function placement(tr: Transform, local: number, fx: AnimFx, cw: number, ch: number, width: number, height: number, fit: number) {
  const x = (evalAnimated(tr.x, local) + fx.dx) * cw
  const y = (evalAnimated(tr.y, local) + fx.dy) * ch
  const scale = evalAnimated(tr.scale, local) * fx.scale * fit
  const rot = ((evalAnimated(tr.rotation, local) + fx.rotation) * Math.PI) / 180
  const cos = Math.cos(rot) * scale
  const sin = Math.sin(rot) * scale
  // M = T(center + offset) · R · S · T(-size/2)
  const tx = cw / 2 + x - (cos * width) / 2 + (sin * height) / 2
  const ty = ch / 2 + y - (sin * width) / 2 - (cos * height) / 2
  return [cos, sin, -sin, cos, tx, ty] as [number, number, number, number, number, number]
}

type Matrix = VisualLayer['matrix']
const multiply = (p: Matrix, c: Matrix): Matrix => [
  p[0] * c[0] + p[2] * c[1],
  p[1] * c[0] + p[3] * c[1],
  p[0] * c[2] + p[2] * c[3],
  p[1] * c[2] + p[3] * c[3],
  p[0] * c[4] + p[2] * c[5] + p[4],
  p[1] * c[4] + p[3] * c[5] + p[5]
]

function textStateAt(clip: TextClip, local: number, typed: number): TextState {
  let chars = Infinity
  if (typed < 1) chars = Math.floor(typed * (clip.words.length ? clip.words.map((w) => w.text).join(' ') : clip.text).length)
  const revealed = clip.style.reveal === 'word' && clip.words.length ? clip.words.filter((w) => w.start <= local + 1e-4).length : Infinity
  return { highlight: activeWordIndex(clip, local), revealed, chars }
}

export function layerFor(project: Project, clip: VisualClip | CompoundClip, t: number): VisualLayer | null {
  const { width: cw, height: ch } = project.settings
  const local = Math.min(Math.max(t - clip.start, 0), clip.duration)
  let width: number
  let height: number
  let fit = 1
  let text: TextLayout | null = null
  let asset: Asset | null = null
  let alpha = false
  const fx = 'anim' in clip ? animAt(clip.anim, local, clip.duration) : NO_ANIM

  if (clip.kind === 'text') {
    text = layoutText(clip, cw, ch)
    width = text.width
    height = text.height
  } else if (clip.kind === 'shape') {
    ;({ width, height } = shapeSize(clip, cw, ch))
  } else if (clip.kind === 'adjustment' || clip.kind === 'compound') {
    width = cw
    height = ch
  } else {
    ;({ asset, alpha } = pixelSource(project, clip))
    const base = project.assets[clip.assetId]
    // Geometry always follows the original media so toggling background removal never jumps.
    width = base?.width || asset?.width || cw
    height = base?.height || asset?.height || ch
    fit = Math.min(cw / width, ch / height)
  }

  const tr = clip.transform
  let matrix = placement(tr, local, fx, cw, ch, width, height, fit)
  let opacity = Math.min(1, Math.max(0, evalAnimated(tr.opacity, local))) * fx.opacity
  if ('parent' in clip && clip.parent) {
    // Nested clip: the compound's transform wraps the clip's own (canvas-sized group).
    const pl = Math.min(Math.max(t - clip.parent.start, 0), clip.parent.duration)
    matrix = multiply(placement(clip.parent.transform, pl, NO_ANIM, cw, ch, cw, ch, 1), matrix)
    opacity *= Math.min(1, Math.max(0, evalAnimated(clip.parent.transform.opacity, pl)))
  }

  const media = clip.kind === 'video' || clip.kind === 'image' ? clip : null
  const graded = media ?? (clip.kind === 'adjustment' ? clip : null)
  const lutAsset = graded?.color.lutAssetId ? project.assets[graded.color.lutAssetId] : undefined
  const masked = media ?? (clip.kind === 'adjustment' ? clip : null)
  return {
    clip,
    local,
    sourceTime: clip.kind === 'video' ? extendedSourceTime(clip, t, project.assets[clip.assetId]?.duration ?? 0) : 0,
    asset,
    alpha,
    width,
    height,
    text,
    textState: clip.kind === 'text' ? textStateAt(clip, local, fx.typed) : null,
    progress: clip.kind === 'shape' && clip.shape === 'progress' ? progressAt(clip, local) : 0,
    effect: clip.kind === 'adjustment' && clip.effect.type !== 'none' && (clip.effect.amount > 0 || !effectNeedsAmount(clip.effect.type)) ? clip.effect : null,
    matrix,
    opacity,
    mask: masked && masked.mask.type !== 'none' ? masked.mask : null,
    chroma: media?.chroma.enabled ? media.chroma : null,
    crop: media && !isFullCrop(media.crop) ? media.crop : null,
    color: graded && !isNeutral(graded.color) ? graded.color : null,
    curves: graded && !curvesNeutral(graded.color.curves) ? graded.color.curves : null,
    lutPath: lutAsset?.kind === 'lut' ? lutAsset.path : null,
    lutIntensity: graded?.color.lutIntensity ?? 0,
    blend: media?.blend ?? 'normal',
    wipe: null,
    blur: null
  }
}

function applyFx(layer: VisualLayer, fx: TransitionFx, cw: number, ch: number) {
  layer.opacity *= fx.opacity
  const m = layer.matrix
  if (fx.rotate) {
    // Rotate about the layer's centre.
    const cx = m[0] * (layer.width / 2) + m[2] * (layer.height / 2) + m[4]
    const cy = m[1] * (layer.width / 2) + m[3] * (layer.height / 2) + m[5]
    const r = (fx.rotate * Math.PI) / 180
    const cos = Math.cos(r)
    const sin = Math.sin(r)
    const [a, b, c, d, e, f] = m
    m[0] = cos * a - sin * b
    m[1] = sin * a + cos * b
    m[2] = cos * c - sin * d
    m[3] = sin * c + cos * d
    m[4] = cos * (e - cx) - sin * (f - cy) + cx
    m[5] = sin * (e - cx) + cos * (f - cy) + cy
  }
  if (fx.scale !== 1) {
    // Scale about the layer's centre.
    const cx = m[0] * (layer.width / 2) + m[2] * (layer.height / 2) + m[4]
    const cy = m[1] * (layer.width / 2) + m[3] * (layer.height / 2) + m[5]
    for (let i = 0; i < 4; i++) m[i] *= fx.scale
    m[4] = cx + fx.scale * (m[4] - cx)
    m[5] = cy + fx.scale * (m[5] - cy)
  }
  m[4] += fx.dx * cw
  m[5] += fx.dy * ch
  layer.wipe = fx.wipe
  layer.blur = fx.blur ? { x: fx.blur * cw, y: 0 } : null
}

/** Visual layers at time t, bottom to top. */
export function evaluateFrame(project: Project, t: number): VisualLayer[] {
  const { width: cw, height: ch } = project.settings
  const layers: VisualLayer[] = []
  for (const track of project.tracks) {
    if (track.kind === 'audio' || track.hidden) continue
    // Start order keeps the incoming clip above the outgoing one during a transition.
    const clips = (Object.values(project.clips) as RenderClip[])
      .filter((c): c is VisualClip => c.trackId === track.id && isVisual(c))
      .sort((a, b) => a.start - b.start)
    for (const clip of clips) {
      const media = clip.kind === 'video' || clip.kind === 'image' ? clip : null
      const [from, to] = media ? visibleRange(project, media) : [clip.start, clipEnd(clip)]
      if (t < from - EPS || t >= to - EPS) continue
      const layer = layerFor(project, clip, t)
      if (!layer) continue
      if (media) {
        const clip = media
        const into = transitionInto(project, clip)
        if (into && t >= into.start && t < into.end) applyFx(layer, transitionFx(into.type, (t - into.start) / (into.end - into.start), 'in'), cw, ch)
        const out = transitionOutOf(project, clip)
        if (out && t >= out.start && t < out.end) applyFx(layer, transitionFx(out.type, (t - out.start) / (out.end - out.start), 'out'), cw, ch)
      }
      layers.push(layer)
    }
  }
  return layers
}

/** Visible (cropped) rectangle of a layer in media pixels: [x0, y0, x1, y1]. */
function visibleRect(layer: VisualLayer): [number, number, number, number] {
  const c = layer.crop
  return [(c?.left ?? 0) * layer.width, (c?.top ?? 0) * layer.height, (1 - (c?.right ?? 0)) * layer.width, (1 - (c?.bottom ?? 0)) * layer.height]
}

/** Corners of a layer's visible quad in canvas pixels (TL, TR, BR, BL). */
export function layerCorners(layer: VisualLayer): [number, number][] {
  const [a, b, c, d, e, f] = layer.matrix
  const [x0, y0, x1, y1] = visibleRect(layer)
  const pt = (x: number, y: number): [number, number] => [a * x + c * y + e, b * x + d * y + f]
  return [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)]
}

/** True when canvas point (px, py) is inside the layer's visible quad. */
export function hitTest(layer: VisualLayer, px: number, py: number): boolean {
  const [a, b, c, d, e, f] = layer.matrix
  const det = a * d - b * c
  if (Math.abs(det) < 1e-9) return false
  const x = (d * (px - e) - c * (py - f)) / det
  const y = (-b * (px - e) + a * (py - f)) / det
  const [x0, y0, x1, y1] = visibleRect(layer)
  return x >= x0 && y >= y0 && x <= x1 && y <= y1
}
