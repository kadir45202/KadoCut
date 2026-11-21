import type { EffectType } from '@shared/project/schema'
import { Compositor } from '@renderer/engine/compositor'
import type { VisualLayer } from '@renderer/engine/scene'

/**
 * Effect preview tiles: renders a small sample picture through each effect once with the real
 * compositor, so the tiles look exactly like the result.
 */

const W = 128
const H = 80

function samplePicture(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#3a7bd5')
  sky.addColorStop(0.6, '#f6a35c')
  sky.addColorStop(1, '#f96e5b')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#ffe9a8'
  g.beginPath()
  g.arc(W * 0.68, H * 0.52, H * 0.16, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#5b3a63'
  g.beginPath()
  g.moveTo(0, H)
  g.lineTo(0, H * 0.62)
  g.lineTo(W * 0.3, H * 0.42)
  g.lineTo(W * 0.55, H * 0.7)
  g.lineTo(W * 0.8, H * 0.55)
  g.lineTo(W, H * 0.68)
  g.lineTo(W, H)
  g.fill()
  g.fillStyle = '#2b1d33'
  g.fillRect(0, H * 0.84, W, H * 0.16)
  g.fillStyle = '#ffffff'
  g.font = `700 ${H * 0.2}px system-ui, sans-serif`
  g.fillText('Aa', W * 0.08, H * 0.3)
  return c
}

function layer(id: string, effect: VisualLayer['effect']): VisualLayer {
  return {
    clip: { id } as unknown as VisualLayer['clip'],
    local: 0.4,
    sourceTime: 0,
    asset: null,
    alpha: false,
    width: W,
    height: H,
    text: null,
    textState: null,
    progress: 0,
    effect,
    matrix: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    mask: null,
    chroma: null,
    crop: null,
    color: null,
    curves: null,
    lutPath: null,
    lutIntensity: 0,
    blend: 'normal',
    wipe: null,
    blur: null
  }
}

let cache: Promise<Map<EffectType, string>> | null = null

/** JPEG data URLs keyed by effect type (rendered once per session). */
export function effectThumbs(effects: { type: EffectType; amount: number }[]): Promise<Map<EffectType, string>> {
  cache ??= new Promise((resolve) => {
    const out = new Map<EffectType, string>()
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    try {
      const comp = new Compositor(canvas, { preserveDrawingBuffer: true })
      const picture = samplePicture()
      const source = { kind: 'element' as const, source: picture, width: W, height: H, version: 1 }
      for (const fx of effects) {
        comp.render([{ layer: layer('picture', null), source }, { layer: layer('fx', fx), source: { kind: 'backdrop' } }], '#000000')
        out.set(fx.type, canvas.toDataURL('image/jpeg', 0.85))
      }
      comp.dispose()
    } catch {
      // No WebGL: tiles fall back to plain labels.
    }
    // Free the context right away; the preview needs the GPU more.
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
    resolve(out)
  })
  return cache
}
