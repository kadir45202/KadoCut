import type { ShapeClip } from '@shared/project/schema'

/**
 * Vector shapes (stickers, call-outs, progress bar) rasterized with Canvas 2D, shared by
 * preview and export. Sizes are canvas pixels.
 */

export function shapeSize(clip: ShapeClip, canvasW: number, canvasH: number): { width: number; height: number } {
  return { width: Math.max(1, clip.width * canvasW), height: Math.max(1, clip.height * canvasH) }
}

/** Everything that changes a shape's pixels (except progress). */
export const shapeKey = (clip: ShapeClip, size: { width: number; height: number }) =>
  JSON.stringify([clip.shape, clip.fill, clip.stroke, clip.strokeWidth, clip.radius, clip.secondary, size.width, size.height])

/** Share of the progress bar that is filled at clip-local time. */
export const progressAt = (clip: ShapeClip, local: number) => (clip.duration > 0 ? Math.min(1, Math.max(0, local / clip.duration)) : 0)

function starPath(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
  const cx = w / 2
  const cy = h / 2
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + Math.cos(a) * r * (w / 2)
    const y = cy + Math.sin(a) * r * (h / 2) + h * 0.05
    if (i) ctx.lineTo(x, y)
    else ctx.moveTo(x, y)
  }
  ctx.closePath()
}

function heartPath(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath()
  ctx.moveTo(w / 2, h * 0.3)
  ctx.bezierCurveTo(w * 0.5, h * 0.05, w * 0.05, h * 0.0, w * 0.03, h * 0.35)
  ctx.bezierCurveTo(w * 0.0, h * 0.6, w * 0.35, h * 0.8, w / 2, h)
  ctx.bezierCurveTo(w * 0.65, h * 0.8, w * 1.0, h * 0.6, w * 0.97, h * 0.35)
  ctx.bezierCurveTo(w * 0.95, h * 0.0, w * 0.5, h * 0.05, w / 2, h * 0.3)
  ctx.closePath()
}

function arrowPath(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
  const head = Math.min(w * 0.45, h)
  const shaft = h * 0.36
  ctx.beginPath()
  ctx.moveTo(0, (h - shaft) / 2)
  ctx.lineTo(w - head, (h - shaft) / 2)
  ctx.lineTo(w - head, 0)
  ctx.lineTo(w, h / 2)
  ctx.lineTo(w - head, h)
  ctx.lineTo(w - head, (h + shaft) / 2)
  ctx.lineTo(0, (h + shaft) / 2)
  ctx.closePath()
}

/** Rasterizes a shape at `scale` texture pixels per canvas pixel. */
export function rasterizeShape(clip: ShapeClip, width: number, height: number, progress: number, scale: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width * scale)), Math.max(1, Math.ceil(height * scale)))
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  const stroke = clip.strokeWidth * Math.min(width, height)
  // Keep the outline inside the box so the layer bounds stay exact.
  const inset = stroke / 2
  ctx.translate(inset, inset)
  const w = Math.max(0.5, width - stroke)
  const h = Math.max(0.5, height - stroke)
  const round = (clip.radius * Math.min(w, h)) / 2

  switch (clip.shape) {
    case 'rectangle':
      ctx.beginPath()
      ctx.roundRect(0, 0, w, h, round)
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      break
    case 'triangle':
      ctx.beginPath()
      ctx.moveTo(w / 2, 0)
      ctx.lineTo(w, h)
      ctx.lineTo(0, h)
      ctx.closePath()
      break
    case 'star':
      starPath(ctx, w, h)
      break
    case 'heart':
      heartPath(ctx, w, h)
      break
    case 'arrow':
      arrowPath(ctx, w, h)
      break
    case 'line':
      ctx.beginPath()
      ctx.roundRect(0, 0, w, h, h / 2)
      break
    case 'progress': {
      ctx.fillStyle = clip.secondary
      ctx.beginPath()
      ctx.roundRect(0, 0, w, h, round)
      ctx.fill()
      if (progress > 0) {
        ctx.save()
        ctx.clip()
        ctx.fillStyle = clip.fill
        ctx.fillRect(0, 0, w * progress, h)
        ctx.restore()
      }
      ctx.beginPath()
      ctx.roundRect(0, 0, w, h, round)
      if (stroke > 0) {
        ctx.strokeStyle = clip.stroke
        ctx.lineWidth = stroke
        ctx.stroke()
      }
      return canvas
    }
  }
  ctx.fillStyle = clip.fill
  ctx.fill()
  if (stroke > 0) {
    ctx.strokeStyle = clip.stroke
    ctx.lineWidth = stroke
    ctx.lineJoin = 'round'
    ctx.stroke()
  }
  return canvas
}
