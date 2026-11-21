import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import s from './photos.module.css'

/** RGB histogram of the last developed preview, filled in by the preview after each render. */
export const useHistogram = create<{ bins: [Uint32Array, Uint32Array, Uint32Array] | null }>(() => ({ bins: null }))

/** Fills the 256-bin R/G/B histograms from RGBA pixels of a small render. */
export function measureHistogram(px: Uint8Array) {
  const bins: [Uint32Array, Uint32Array, Uint32Array] = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]
  for (let i = 0; i < px.length; i += 4) {
    bins[0][px[i]]++
    bins[1][px[i + 1]]++
    bins[2][px[i + 2]]++
  }
  useHistogram.setState({ bins })
}

const W = 256
const H = 96

export function Histogram() {
  const bins = useHistogram((st) => st.bins)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#0b0b0d'
    ctx.fillRect(0, 0, W, H)
    if (!bins) return
    let max = 1
    for (const b of bins) for (let v = 2; v < 254; v++) max = Math.max(max, b[v])
    ctx.globalCompositeOperation = 'lighter'
    const colors = ['rgba(255, 69, 58, 0.7)', 'rgba(48, 209, 88, 0.7)', 'rgba(10, 132, 255, 0.8)']
    bins.forEach((b, c) => {
      ctx.fillStyle = colors[c]
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let v = 0; v < 256; v++) ctx.lineTo((v / 255) * W, H - Math.min(1, b[v] / max) * (H - 4))
      ctx.lineTo(W, H)
      ctx.fill()
    })
  }, [bins])
  return <canvas ref={ref} width={W} height={H} className={s.histogram} data-testid="photo-histogram" />
}
