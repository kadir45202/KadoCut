import { useMemo, useRef } from 'react'
import type { SpeedPoint } from '@shared/project/schema'
import { CURVE_MAX, CURVE_MIN, curveRate } from '@renderer/core/project/speed'
import s from './speed.module.css'

const W = 276
const H = 132
const PAD = 10

// Vertical axis is logarithmic so 0.1x … 10x is evenly spread around 1x.
const yOf = (rate: number) => PAD + (1 - (Math.log10(rate) + 1) / 2) * (H - PAD * 2)
const rateOf = (y: number) => Math.min(CURVE_MAX, Math.max(CURVE_MIN, 10 ** ((1 - (y - PAD) / (H - PAD * 2)) * 2 - 1)))
const xOf = (u: number) => PAD + u * (W - PAD * 2)
const uOf = (x: number) => Math.min(1, Math.max(0, (x - PAD) / (W - PAD * 2)))

function path(points: SpeedPoint[], w = W, h = H): string {
  const n = 80
  let d = ''
  for (let i = 0; i <= n; i++) {
    const u = i / n
    const x = (xOf(u) / W) * w
    const y = (yOf(curveRate(points, u)) / H) * h
    d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }
  return d
}

export function CurveThumb({ points }: { points: SpeedPoint[] }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={s.thumb} aria-hidden>
      <line x1={0} x2={W} y1={yOf(1)} y2={yOf(1)} className={s.axis} />
      <path d={path(points)} className={s.thumbLine} />
    </svg>
  )
}

interface Props {
  points: SpeedPoint[]
  onStart(): void
  onChange(points: SpeedPoint[]): void
  onEnd(): void
}

export function CurveEditor({ points, onStart, onChange, onEnd }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const d = useMemo(() => path(points), [points])

  const local = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H }
  }

  const move = (e: React.PointerEvent) => {
    const i = drag.current
    if (i === null) return
    const { x, y } = local(e)
    const next = points.map((p) => ({ ...p }))
    // Endpoints stay at 0 and 1; inner points cannot pass their neighbours.
    const minU = i === 0 ? 0 : points[i - 1].x + 0.02
    const maxU = i === points.length - 1 ? 1 : points[i + 1].x - 0.02
    next[i] = { x: i === 0 ? 0 : i === points.length - 1 ? 1 : Math.min(maxU, Math.max(minU, uOf(x))), y: Math.round(rateOf(y) * 100) / 100 }
    onChange(next)
  }

  const addPoint = (e: React.MouseEvent) => {
    const { x } = local(e)
    const u = uOf(x)
    if (points.some((p) => Math.abs(p.x - u) < 0.03)) return
    onChange([...points, { x: u, y: Math.round(curveRate(points, u) * 100) / 100 }].sort((a, b) => a.x - b.x))
  }

  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className={s.editor} onPointerMove={move} onDoubleClick={addPoint}>
      {[0.1, 0.5, 1, 2, 5, 10].map((r) => (
        <g key={r}>
          <line x1={PAD} x2={W - PAD} y1={yOf(r)} y2={yOf(r)} className={r === 1 ? s.axis : s.grid} />
          <text x={W - PAD - 2} y={yOf(r) - 3} className={s.label} textAnchor="end">
            {r}x
          </text>
        </g>
      ))}
      <path d={d} className={s.line} />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={xOf(p.x)}
          cy={yOf(p.y)}
          r={5.5}
          className={s.point}
          onPointerDown={(e) => {
            e.stopPropagation()
            ;(e.target as Element).setPointerCapture(e.pointerId)
            drag.current = i
            onStart()
          }}
          onPointerUp={() => {
            if (drag.current === null) return
            drag.current = null
            onEnd()
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (i > 0 && i < points.length - 1) onChange(points.filter((_, j) => j !== i))
          }}
        >
          <title>{p.y}x</title>
        </circle>
      ))}
    </svg>
  )
}
