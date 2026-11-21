import { useEffect, useRef, useState } from 'react'
import type { PreviewEngine } from '@renderer/engine/preview'
import { useT } from '@renderer/i18n'
import { Segmented } from '@renderer/ui/controls'
import s from './editor.module.css'

type Mode = 'histogram' | 'waveform' | 'vector'

const W = 256
const H = 128
/** Frames are sampled at this width (keeps the scopes cheap during playback). */
const SAMPLE = 160

/**
 * Colour scopes of the preview frame: RGB histogram, luma waveform and vectorscope. They read the
 * preview canvas right after each render, at most ~8 times per second.
 */
export function Scopes({ engine }: { engine: PreviewEngine | null }) {
  const t = useT()
  const [mode, setMode] = useState<Mode>('waveform')
  const out = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    if (!engine) return
    const small = document.createElement('canvas')
    const g = small.getContext('2d', { willReadFrequently: true })!
    let last = 0
    const onFrame = (canvas: HTMLCanvasElement) => {
      const now = performance.now()
      if (now - last < 120 || !out.current || !canvas.width) return
      last = now
      const w = SAMPLE
      const h = Math.max(1, Math.round((SAMPLE * canvas.height) / canvas.width))
      small.width = w
      small.height = h
      g.drawImage(canvas, 0, 0, w, h)
      const px = g.getImageData(0, 0, w, h).data
      const ctx = out.current.getContext('2d')!
      if (modeRef.current === 'histogram') drawHistogram(ctx, px)
      else if (modeRef.current === 'waveform') drawWaveform(ctx, px, w, h)
      else drawVectorscope(ctx, px)
    }
    engine.frameListeners.add(onFrame)
    engine.requestRender()
    return () => void engine.frameListeners.delete(onFrame)
  }, [engine])

  // Redraw the paused frame in the new mode.
  useEffect(() => engine?.requestRender(), [engine, mode])

  return (
    <div className={s.scopes} data-testid="scopes">
      <canvas ref={out} width={W} height={H} className={s.scopeCanvas} />
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        block
        options={[
          { value: 'histogram', label: t('viewer.scope.histogram') },
          { value: 'waveform', label: t('viewer.scope.waveform') },
          { value: 'vector', label: t('viewer.scope.vector') }
        ]}
      />
    </div>
  )
}

function clear(ctx: CanvasRenderingContext2D) {
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#0b0b0d'
  ctx.fillRect(0, 0, W, H)
}

function drawHistogram(ctx: CanvasRenderingContext2D, px: Uint8ClampedArray) {
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  for (let i = 0; i < px.length; i += 4) {
    bins[0][px[i]]++
    bins[1][px[i + 1]]++
    bins[2][px[i + 2]]++
  }
  // Ignore the clipped ends when scaling so a black border doesn't flatten everything.
  let max = 1
  for (const b of bins) for (let v = 1; v < 255; v++) max = Math.max(max, b[v])
  clear(ctx)
  ctx.globalCompositeOperation = 'lighter'
  const colors = ['rgba(255, 69, 58, 0.75)', 'rgba(48, 209, 88, 0.75)', 'rgba(10, 132, 255, 0.85)']
  bins.forEach((b, c) => {
    ctx.fillStyle = colors[c]
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let v = 0; v < 256; v++) ctx.lineTo((v / 255) * W, H - Math.min(1, b[v] / max) * (H - 4))
    ctx.lineTo(W, H)
    ctx.fill()
  })
}

function drawWaveform(ctx: CanvasRenderingContext2D, px: Uint8ClampedArray, w: number, h: number) {
  // Column x of the frame → luma distribution (Rec. 709) in that column.
  const grid = new Uint16Array(w * H)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
      grid[Math.round((1 - l / 255) * (H - 1)) * w + x]++
    }
  }
  const img = ctx.createImageData(w, H)
  const gain = 2200 / h
  for (let i = 0; i < grid.length; i++) {
    const v = Math.min(255, grid[i] * gain)
    img.data[i * 4] = v * 0.55
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v * 0.6
    img.data[i * 4 + 3] = 255
  }
  clear(ctx)
  const tmp = document.createElement('canvas')
  tmp.width = w
  tmp.height = H
  tmp.getContext('2d')!.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(tmp, 0, 0, W, H)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 1
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(f * (H - 1)) + 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
}

const cbcr = (r: number, g: number, b: number): [number, number] => [
  (-0.1146 * r - 0.3854 * g + 0.5 * b) / 255,
  (0.5 * r - 0.4542 * g - 0.0458 * b) / 255
]

function drawVectorscope(ctx: CanvasRenderingContext2D, px: Uint8ClampedArray) {
  const size = H
  const cx = W / 2
  const r = size / 2 - 4
  const grid = new Uint16Array(size * size)
  for (let i = 0; i < px.length; i += 4) {
    const [u, v] = cbcr(px[i], px[i + 1], px[i + 2])
    const x = Math.round(size / 2 + u * 2 * r)
    const y = Math.round(size / 2 - v * 2 * r)
    if (x >= 0 && y >= 0 && x < size && y < size) grid[y * size + x]++
  }
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < grid.length; i++) {
    const n = grid[i]
    if (!n) continue
    const v = Math.min(255, 60 + n * 30)
    img.data[i * 4] = v * 0.7
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v * 0.7
    img.data[i * 4 + 3] = 255
  }
  clear(ctx)
  ctx.putImageData(img, cx - size / 2, 0)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
  ctx.beginPath()
  ctx.arc(cx, size / 2, r, 0, Math.PI * 2)
  ctx.stroke()
  // Skin-tone line and 75% colour targets.
  const skin = (123 * Math.PI) / 180
  ctx.strokeStyle = 'rgba(255, 200, 150, 0.35)'
  ctx.beginPath()
  ctx.moveTo(cx, size / 2)
  ctx.lineTo(cx + Math.cos(skin) * r, size / 2 - Math.sin(skin) * r)
  ctx.stroke()
  ctx.font = '9px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const [label, rgb] of [['R', [191, 0, 0]], ['Y', [191, 191, 0]], ['G', [0, 191, 0]], ['C', [0, 191, 191]], ['B', [0, 0, 191]], ['M', [191, 0, 191]]] as const) {
    const [u, v] = cbcr(rgb[0], rgb[1], rgb[2])
    const x = cx + u * 2 * r
    const y = size / 2 - v * 2 * r
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
    ctx.strokeRect(x - 4, y - 4, 8, 8)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.fillText(label, x + (u > 0 ? 11 : -11), y)
  }
}
