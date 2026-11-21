import { useEffect, useRef } from 'react'

const STEPS = [1 / 30, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

function label(t: number, step: number, fps: number): string {
  const whole = Math.round(t * 1000) / 1000
  const m = Math.floor(whole / 60)
  const sec = Math.floor(whole % 60)
  if (step < 1) {
    const f = Math.round((whole % 1) * fps) % Math.round(fps)
    return f === 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${f}f`
  }
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Time ruler drawn on a canvas for the visible range only. */
export function Ruler({ view, pps, fps }: { view: { left: number; width: number }; pps: number; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, view.width)
    const h = 26
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, h)

    const major = STEPS.find((st) => st * pps >= 90) ?? 600
    const minor = major / (major * pps >= 180 ? 10 : 5)
    const t0 = view.left / pps
    const t1 = (view.left + w) / pps
    ctx.font = '500 10px "Inter Variable", sans-serif'
    ctx.textBaseline = 'top'

    const perMajor = Math.round(major / minor)
    // Integer tick index avoids floating-point drift in the labels.
    for (let i = Math.floor(t0 / minor); i * minor <= t1; i++) {
      const t = i * minor
      const x = Math.round(t * pps - view.left) + 0.5
      const isMajor = i % perMajor === 0
      ctx.strokeStyle = isMajor ? 'rgba(235,235,245,0.35)' : 'rgba(235,235,245,0.14)'
      ctx.beginPath()
      ctx.moveTo(x, isMajor ? 14 : 19)
      ctx.lineTo(x, h)
      ctx.stroke()
      if (isMajor) {
        ctx.fillStyle = 'rgba(235,235,245,0.55)'
        ctx.fillText(label(Math.max(0, t), major, fps), x + 4, 4)
      }
    }
  }, [view.left, view.width, pps, fps])

  return <canvas ref={ref} style={{ position: 'absolute', left: view.left, top: 0, pointerEvents: 'none' }} />
}
