import type { BrushStroke, PhotoDevelop, PhotoMask } from '@shared/photo'

/**
 * Local adjustment masks. Every mask is rasterised (in plain TypeScript, so it is testable and
 * the same everywhere) into an 8-bit coverage image over the straightened frame; the develop
 * shader reads them from a texture array. Brush masks only paint what was added since last time.
 */

/** Long edge (pixels) of a mask image. */
export const MASK_EDGE = 1024

type Radial = Extract<PhotoMask, { kind: 'radial' }>
type Linear = Extract<PhotoMask, { kind: 'linear' }>
type Crop = PhotoDevelop['crop']

export function maskSize(width: number, height: number, edge = MASK_EDGE): { w: number; h: number } {
  const k = Math.min(1, edge / Math.max(width, height))
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) }
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Coverage (0–1) of a radial mask at frame point (x, y) of a W×H photo. */
export function radialWeight(m: Radial, x: number, y: number, W: number, H: number): number {
  const L = Math.max(W, H)
  const a = (m.angle * Math.PI) / 180
  const dx = (x - m.cx) * W
  const dy = (y - m.cy) * H
  const lx = (dx * Math.cos(a) + dy * Math.sin(a)) / (m.rx * L)
  const ly = (-dx * Math.sin(a) + dy * Math.cos(a)) / (m.ry * L)
  const f = Math.max(m.feather, 0.01)
  return 1 - smooth(1 - f, 1, Math.hypot(lx, ly))
}

/** Coverage of a linear gradient: 1 before (x0, y0), fading to 0 at (x1, y1). */
export function linearWeight(m: Linear, x: number, y: number, W: number, H: number): number {
  const bx = (m.x1 - m.x0) * W
  const by = (m.y1 - m.y0) * H
  const len2 = bx * bx + by * by
  if (len2 < 1e-9) return 0
  const t = ((x - m.x0) * W * bx + (y - m.y0) * H * by) / len2
  return 1 - smooth(0, 1, t)
}

/** Paints (or erases) one capsule-shaped segment in mask pixels. */
function paintSegment(buf: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, r: number, feather: number, erase: boolean) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r))
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r))
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r))
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r))
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  // At least a pixel of softness keeps hard brushes antialiased.
  const f = Math.max(feather, 1 / r)
  for (let py = y0; py <= y1; py++) {
    const cy = py + 0.5
    for (let px = x0; px <= x1; px++) {
      const cx = px + 0.5
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((cx - ax) * vx + (cy - ay) * vy) / len2)) : 0
      const dx = cx - (ax + t * vx)
      const dy = cy - (ay + t * vy)
      const d = Math.sqrt(dx * dx + dy * dy) / r
      if (d >= 1) continue
      const v = Math.round((1 - smooth(1 - f, 1, d)) * 255)
      const i = py * w + px
      buf[i] = erase ? Math.min(buf[i], 255 - v) : Math.max(buf[i], v)
    }
  }
}

/** Paints a stroke's segments from point `from` on (re-painting a segment is harmless). */
export function paintStroke(buf: Uint8Array, w: number, h: number, s: BrushStroke, from = 0) {
  const r = Math.max(0.75, s.size * Math.max(w, h))
  const p = s.points
  const n = Math.floor(p.length / 2)
  if (from === 0 && n > 0) paintSegment(buf, w, h, p[0] * w, p[1] * h, p[0] * w, p[1] * h, r, s.feather, s.erase)
  for (let i = Math.max(1, from); i < n; i++) paintSegment(buf, w, h, p[i * 2 - 2] * w, p[i * 2 - 1] * h, p[i * 2] * w, p[i * 2 + 1] * h, r, s.feather, s.erase)
}

/** Full rasterisation of one mask at w×h (invert is applied by the shader). */
export function rasterMask(mask: PhotoMask, w: number, h: number): Uint8Array {
  const buf = new Uint8Array(w * h)
  if (mask.kind === 'brush') {
    for (const s of mask.strokes) paintStroke(buf, w, h, s)
    return buf
  }
  const weight = mask.kind === 'radial' ? radialWeight : linearWeight
  for (let y = 0; y < h; y++) {
    const fy = (y + 0.5) / h
    for (let x = 0; x < w; x++) buf[y * w + x] = Math.round(weight(mask as never, (x + 0.5) / w, fy, w, h) * 255)
  }
  return buf
}

const geometry = (m: PhotoMask) => (m.kind === 'radial' ? [m.cx, m.cy, m.rx, m.ry, m.angle, m.feather] : m.kind === 'linear' ? [m.x0, m.y0, m.x1, m.y1] : []).join(',')

interface Entry {
  mask: PhotoMask
  data: Uint8Array
  w: number
  h: number
}

/** Remembers each mask's image so slider edits never re-rasterise, and brushing stays incremental. */
export class MaskRaster {
  private entries = new Map<string, Entry>()

  /** The mask's pixels and whether they differ from the previous call for this mask id. */
  get(mask: PhotoMask, w: number, h: number): { data: Uint8Array; changed: boolean } {
    const old = this.entries.get(mask.id)
    if (old && old.w === w && old.h === h && old.mask.kind === mask.kind) {
      if (mask.kind !== 'brush' && geometry(old.mask) === geometry(mask)) return { data: old.data, changed: false }
      if (mask.kind === 'brush' && old.mask.kind === 'brush') {
        const before = old.mask.strokes
        const now = mask.strokes
        if (before === now) return { data: old.data, changed: false }
        if (extendsStrokes(before, now)) {
          const last = before.length - 1
          if (last >= 0) paintStroke(old.data, w, h, now[last], Math.max(0, before[last].points.length / 2 - 1))
          for (let i = last + 1; i < now.length; i++) paintStroke(old.data, w, h, now[i])
          old.mask = mask
          return { data: old.data, changed: true }
        }
      }
    }
    const data = rasterMask(mask, w, h)
    this.entries.set(mask.id, { mask, data, w, h })
    return { data, changed: true }
  }

  /** Drops masks that are not in use any more. */
  keep(ids: Set<string>) {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id)
  }
}

/** True when `now` only adds points / strokes to `before` (what painting does). */
function extendsStrokes(before: BrushStroke[], now: BrushStroke[]): boolean {
  if (now.length < before.length) return false
  for (let i = 0; i < before.length - 1; i++) if (before[i] !== now[i]) return false
  const k = before.length - 1
  if (k < 0) return true
  const a = before[k]
  const b = now[k]
  if (a === b) return true
  if (a.size !== b.size || a.feather !== b.feather || a.erase !== b.erase || b.points.length < a.points.length) return false
  for (let i = 0; i < a.points.length; i++) if (a.points[i] !== b.points[i]) return false
  return true
}

/** Part of the crop drawn on screen, in crop fractions (zoomed in it is a window that pans). */
export interface ViewRect {
  x: number
  y: number
  w: number
  h: number
}

export const FULL_VIEW: ViewRect = { x: 0, y: 0, w: 1, h: 1 }

/** Point on the drawn canvas (0–1 fractions) → frame fraction (the shader's mapping). */
export function viewToFrame(u: number, v: number, crop: Crop, view: ViewRect, W: number, H: number): [number, number] {
  const qx = (view.x + u * view.w - 0.5) * crop.w * W
  const qy = (view.y + v * view.h - 0.5) * crop.h * H
  const a = (crop.angle * Math.PI) / 180
  const rx = Math.cos(a) * qx - Math.sin(a) * qy
  const ry = Math.sin(a) * qx + Math.cos(a) * qy
  return [crop.x + crop.w / 2 + rx / W, crop.y + crop.h / 2 + ry / H]
}

/** Inverse of viewToFrame. */
export function frameToView(x: number, y: number, crop: Crop, view: ViewRect, W: number, H: number): [number, number] {
  const dx = (x - crop.x - crop.w / 2) * W
  const dy = (y - crop.y - crop.h / 2) * H
  const a = (crop.angle * Math.PI) / 180
  const qx = Math.cos(a) * dx + Math.sin(a) * dy
  const qy = -Math.sin(a) * dx + Math.cos(a) * dy
  return [(qx / (crop.w * W) + 0.5 - view.x) / view.w, (qy / (crop.h * H) + 0.5 - view.y) / view.h]
}

/** A zoom window of the given size centred near (cx, cy), kept inside the crop. */
export function zoomView(cx: number, cy: number, w: number, h: number): ViewRect {
  const vw = Math.min(1, w)
  const vh = Math.min(1, h)
  return { x: Math.min(1 - vw, Math.max(0, cx - vw / 2)), y: Math.min(1 - vh, Math.max(0, cy - vh / 2)), w: vw, h: vh }
}
