import type { Photo } from '@shared/photo'
import { PhotoRenderer, croppedSize } from './develop'
import { loadPhotoBitmap } from './images'

export type ExportFormat = 'jpg' | 'png'

export interface Watermark {
  text: string
  position: 'tl' | 'tr' | 'bl' | 'br' | 'center'
  /** Text height as a percentage of the image's short edge. */
  size: number
  opacity: number
}

export interface EncodeOptions {
  format: ExportFormat
  /** JPEG quality, 1–100. */
  quality: number
  /** Longest edge in pixels (0: full size). */
  longEdge: number
  watermark?: Watermark | null
}

/** Draws the developed image with a text watermark onto a 2D canvas. */
function withWatermark(source: HTMLCanvasElement, wm: Watermark): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = source.width
  c.height = source.height
  const g = c.getContext('2d')!
  g.drawImage(source, 0, 0)
  const px = Math.max(8, Math.round((Math.min(c.width, c.height) * wm.size) / 100))
  const margin = Math.round(px * 0.8)
  g.font = `600 ${px}px "Segoe UI", system-ui, sans-serif`
  g.globalAlpha = Math.min(1, Math.max(0.05, wm.opacity))
  g.fillStyle = '#ffffff'
  g.shadowColor = 'rgba(0, 0, 0, 0.45)'
  g.shadowBlur = px * 0.25
  const right = wm.position === 'tr' || wm.position === 'br'
  g.textAlign = wm.position === 'center' ? 'center' : right ? 'right' : 'left'
  g.textBaseline = wm.position === 'center' ? 'middle' : wm.position.startsWith('t') ? 'top' : 'bottom'
  const x = wm.position === 'center' ? c.width / 2 : right ? c.width - margin : margin
  const y = wm.position === 'center' ? c.height / 2 : wm.position.startsWith('t') ? margin : c.height - margin
  g.fillText(wm.text, x, y)
  return c
}

/** Renders one photo from its full-size original with all settings and returns the encoded file. */
export async function encodePhoto(photo: Photo, opts: EncodeOptions): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  const r = new PhotoRenderer(canvas)
  try {
    const bmp = await loadPhotoBitmap(photo, r.maxSize)
    r.setImage(bmp, bmp.width, bmp.height)
    const size = croppedSize(bmp.width, bmp.height, photo.develop.crop, opts.longEdge || Infinity)
    bmp.close()
    if (size.width > r.maxSize || size.height > r.maxSize) throw new Error('Image too large for this graphics card')
    r.render(photo.develop, size.width, size.height)
    const out = opts.watermark?.text.trim() ? withWatermark(canvas, opts.watermark) : canvas
    const blob = await new Promise<Blob | null>((res) => out.toBlob(res, opts.format === 'jpg' ? 'image/jpeg' : 'image/png', opts.quality / 100))
    if (!blob) throw new Error('Encoding failed')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    r.dispose()
  }
}

/** File name (without extension) of the i-th exported photo. */
export function exportName(photoName: string, index: number, custom: string): string {
  const base = custom.trim()
  if (!base) return photoName.replace(/\.[^.]+$/, '')
  return `${base}-${String(index + 1).padStart(3, '0')}`
}
