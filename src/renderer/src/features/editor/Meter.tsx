import { useEffect, useRef } from 'react'
import { useEditor } from '@renderer/core/store/editor'
import { getPreview } from '@renderer/engine/preview'
import { useT } from '@renderer/i18n'
import s from './editor.module.css'

const FLOOR = -60
const W = 72
const H = 14

/** Stereo peak meter of the preview mix (-60…0 dBFS) with a short peak hold. */
export function AudioMeter() {
  const t = useT()
  const ref = useRef<HTMLCanvasElement>(null)
  const playing = useEditor((st) => st.playing)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    const g = canvas.getContext('2d')!
    g.scale(dpr, dpr)
    const shown = [FLOOR, FLOOR]
    const hold = [{ db: FLOOR, at: 0 }, { db: FLOOR, at: 0 }]
    let raf = 0
    const draw = () => {
      const levels = getPreview()?.levels() ?? [-Infinity, -Infinity]
      const now = performance.now()
      g.clearRect(0, 0, W, H)
      levels.forEach((db, ch) => {
        const v = Math.max(FLOOR, Math.min(0, db))
        // Fast attack, ~20 dB/s fall.
        shown[ch] = v > shown[ch] ? v : Math.max(v, shown[ch] - 0.35)
        if (shown[ch] >= hold[ch].db || now - hold[ch].at > 1200) hold[ch] = { db: shown[ch], at: now }
        const y = ch * (H / 2 + 1)
        const h = H / 2 - 1
        const x = ((shown[ch] - FLOOR) / -FLOOR) * W
        const grad = g.createLinearGradient(0, 0, W, 0)
        grad.addColorStop(0, '#30d158')
        grad.addColorStop(0.75, '#30d158')
        grad.addColorStop(0.85, '#ffd60a')
        grad.addColorStop(1, '#ff453a')
        g.fillStyle = 'rgba(255, 255, 255, 0.08)'
        g.fillRect(0, y, W, h)
        g.fillStyle = grad
        g.fillRect(0, y, x, h)
        const hx = ((hold[ch].db - FLOOR) / -FLOOR) * W
        if (hold[ch].db > FLOOR) {
          g.fillStyle = hold[ch].db > -3 ? '#ff453a' : '#ffffff'
          g.fillRect(Math.min(W - 1, hx), y, 1, h)
        }
      })
      if (useEditor.getState().playing || shown.some((v) => v > FLOOR)) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return <canvas ref={ref} className={s.meter} style={{ width: W, height: H }} aria-label={t('viewer.meter')} title={t('viewer.meter')} data-testid="meter" />
}
