import type { CropAspect, PhotoDevelop } from '@shared/photo'

/**
 * Crop geometry. The crop is an axis-aligned rectangle (fractions of the image) that the renderer
 * rotates by `angle` around its centre when sampling, so in source pixels the cropped area is the
 * rectangle turned by +angle. Helpers keep that turned rectangle inside the photo.
 */

type Crop = PhotoDevelop['crop']

/** Width / height of an aspect preset in pixels (null = free). */
export function aspectRatio(aspect: CropAspect, imgW: number, imgH: number): number | null {
  if (aspect === 'free') return null
  if (aspect === 'original') return imgW / imgH
  const [a, b] = aspect.split(':').map(Number)
  return a / b
}

/** Corners of the turned crop in source pixels (TL, TR, BR, BL). */
export function cropCorners(c: Crop, imgW: number, imgH: number): [number, number][] {
  const cx = (c.x + c.w / 2) * imgW
  const cy = (c.y + c.h / 2) * imgH
  const hw = (c.w * imgW) / 2
  const hh = (c.h * imgH) / 2
  const r = (c.angle * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh]
  ].map(([x, y]) => [cx + cos * x - sin * y, cy + sin * x + cos * y] as [number, number])
}

const inside = (c: Crop, imgW: number, imgH: number) =>
  cropCorners(c, imgW, imgH).every(([x, y]) => x >= -0.5 && y >= -0.5 && x <= imgW + 0.5 && y <= imgH + 0.5)

/** Shrinks the crop about its centre (keeping its shape) until the turned rectangle fits the photo. */
export function fitCrop(c: Crop, imgW: number, imgH: number): Crop {
  // Keep the centre on the photo first.
  const cx = Math.min(1, Math.max(0, c.x + c.w / 2))
  const cy = Math.min(1, Math.max(0, c.y + c.h / 2))
  const at = (k: number): Crop => ({ ...c, w: c.w * k, h: c.h * k, x: cx - (c.w * k) / 2, y: cy - (c.h * k) / 2 })
  if (inside(at(1), imgW, imgH)) return at(1)
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (inside(at(mid), imgW, imgH)) lo = mid
    else hi = mid
  }
  const k = Math.max(lo, 0.02 / Math.max(c.w, c.h))
  return at(k)
}

/** The largest crop of an aspect ratio (or the whole photo when free) for the given angle. */
export function maxCrop(aspect: CropAspect, angle: number, imgW: number, imgH: number): Crop {
  const ratio = aspectRatio(aspect, imgW, imgH) ?? imgW / imgH
  // Pixel size that fills the photo at this ratio, then fitted after turning.
  let w = imgW
  let h = imgW / ratio
  if (h > imgH) {
    h = imgH
    w = imgH * ratio
  }
  return fitCrop({ x: (1 - w / imgW) / 2, y: (1 - h / imgH) / 2, w: w / imgW, h: h / imgH, angle, aspect }, imgW, imgH)
}

/** Re-shapes a crop to an aspect ratio around its centre, as large as still fits. */
export function setAspect(c: Crop, aspect: CropAspect, imgW: number, imgH: number): Crop {
  const ratio = aspectRatio(aspect, imgW, imgH)
  if (ratio === null) return { ...c, aspect }
  const area = c.w * imgW * c.h * imgH
  const h = Math.sqrt(area / ratio)
  const w = h * ratio
  const cx = c.x + c.w / 2
  const cy = c.y + c.h / 2
  return fitCrop({ ...c, aspect, w: w / imgW, h: h / imgH, x: cx - w / imgW / 2, y: cy - h / imgH / 2 }, imgW, imgH)
}

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

/**
 * Drags a handle to a source-pixel point. Edges move in the crop's own (turned) axes and the
 * opposite side stays put; an aspect ratio is kept when set.
 */
export function dragCrop(start: Crop, handle: CropHandle, from: [number, number], to: [number, number], imgW: number, imgH: number): Crop {
  const r = (start.angle * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  if (handle === 'move') {
    const dx = (to[0] - from[0]) / imgW
    const dy = (to[1] - from[1]) / imgH
    const moved = { ...start, x: start.x + dx, y: start.y + dy }
    return inside(moved, imgW, imgH) ? moved : start
  }
  const cx = (start.x + start.w / 2) * imgW
  const cy = (start.y + start.h / 2) * imgH
  // Pointer in crop-local axes.
  const px = to[0] - cx
  const py = to[1] - cy
  const lx = cos * px + sin * py
  const ly = -sin * px + cos * py
  let l = (-start.w * imgW) / 2
  let rr = (start.w * imgW) / 2
  let t = (-start.h * imgH) / 2
  let b = (start.h * imgH) / 2
  const min = 16
  if (handle.includes('w')) l = Math.min(lx, rr - min)
  if (handle.includes('e')) rr = Math.max(lx, l + min)
  if (handle.includes('n')) t = Math.min(ly, b - min)
  if (handle.includes('s')) b = Math.max(ly, t + min)
  const ratio = aspectRatio(start.aspect, imgW, imgH)
  if (ratio !== null) {
    const w = rr - l
    const h = b - t
    if (handle === 'n' || handle === 's') {
      // Height leads; width follows around the middle.
      const nw = h * ratio
      const mid = (l + rr) / 2
      l = mid - nw / 2
      rr = mid + nw / 2
    } else if (handle === 'e' || handle === 'w') {
      const nh = w / ratio
      const mid = (t + b) / 2
      t = mid - nh / 2
      b = mid + nh / 2
    } else {
      // Corners: the larger change wins, the anchored corner stays.
      const nh = Math.max(h, w / ratio)
      const nw = nh * ratio
      if (handle.includes('w')) l = rr - nw
      else rr = l + nw
      if (handle.includes('n')) t = b - nh
      else b = t + nh
    }
  }
  const mx = (l + rr) / 2
  const my = (t + b) / 2
  const ncx = cx + cos * mx - sin * my
  const ncy = cy + sin * mx + cos * my
  const w = (rr - l) / imgW
  const h = (b - t) / imgH
  const next = { ...start, w, h, x: ncx / imgW - w / 2, y: ncy / imgH - h / 2 }
  return inside(next, imgW, imgH) ? next : fitCrop(next, imgW, imgH)
}
