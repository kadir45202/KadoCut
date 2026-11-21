import { useRef } from 'react'
import s from './photos.module.css'

const SIZE = 104

/**
 * Colour-grading wheel: angle = hue, distance from the centre = strength. Drag inside the wheel;
 * double-click resets. Reports gestures so a drag is one undo step.
 */
export function ColorWheel({
  hue,
  sat,
  label,
  onBegin,
  onChange,
  onEnd,
  onReset
}: {
  hue: number
  sat: number
  label: string
  onBegin(): void
  onChange(hue: number, sat: number): void
  onEnd(): void
  onReset(): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const read = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    const h = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360
    onChange(Math.round(h), Math.min(1, Math.round(Math.hypot(x, y) * 2 * 100) / 100))
  }
  const rad = (hue * Math.PI) / 180
  const dot = { left: `${50 + Math.cos(rad) * sat * 50}%`, top: `${50 - Math.sin(rad) * sat * 50}%` }
  return (
    <div className={s.wheelBox}>
      <div
        ref={ref}
        className={s.wheel}
        style={{ width: SIZE, height: SIZE }}
        role="slider"
        aria-label={label}
        aria-valuetext={`${hue}°, ${Math.round(sat * 100)}%`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          dragging.current = true
          onBegin()
          read(e)
        }}
        onPointerMove={(e) => dragging.current && read(e)}
        onPointerUp={() => {
          if (!dragging.current) return
          dragging.current = false
          onEnd()
        }}
        onDoubleClick={onReset}
      >
        <span className={s.wheelDot} style={dot} />
      </div>
      <span className={s.wheelLabel}>{label}</span>
    </div>
  )
}
