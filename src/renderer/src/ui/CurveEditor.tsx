import { useMemo, useRef, useState } from 'react'
import type { CurvePoint, Curves } from '@shared/project/schema'
import { CURVE_SIZE, curveTable } from '@renderer/engine/curves'
import { Button, Segmented } from './controls'
import s from './curveEditor.module.css'

type Channel = keyof Curves

const SIZE = 220
/** Room around the plot so edge points are not clipped. */
const PAD = 7
const STROKE: Record<Channel, string> = { master: '#f2f2f7', r: '#ff453a', g: '#30d158', b: '#0a84ff' }

export const CURVE_PRESETS: { id: 'contrast' | 'fade' | 'bright'; points: CurvePoint[] }[] = [
  { id: 'contrast', points: [{ x: 0, y: 0 }, { x: 0.25, y: 0.18 }, { x: 0.75, y: 0.82 }, { x: 1, y: 1 }] },
  { id: 'fade', points: [{ x: 0, y: 0.08 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.94 }] },
  { id: 'bright', points: [{ x: 0, y: 0 }, { x: 0.45, y: 0.58 }, { x: 1, y: 1 }] }
]

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export interface CurveEditorLabels {
  title: string
  channel: Record<Channel, string>
  preset: Record<(typeof CURVE_PRESETS)[number]['id'], string>
  hint: string
}

/**
 * Photo-editor style tone curves (master + R/G/B): drag points, click to add, double-click to
 * remove. Dragging is a gesture (begin → transient… → end) so the owner can make it one undo step.
 */
export function CurveEditor({
  curves,
  labels,
  onBegin,
  onTransient,
  onEnd,
  onSet
}: {
  curves: Curves
  labels: CurveEditorLabels
  onBegin(): void
  onTransient(next: Curves): void
  onEnd(): void
  onSet(next: Curves): void
}) {
  const [channel, setChannel] = useState<Channel>('master')
  const points = curves[channel]
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const path = useMemo(() => {
    const table = curveTable(points)
    return Array.from(table, (y, i) => `${i ? 'L' : 'M'}${((i / (CURVE_SIZE - 1)) * SIZE).toFixed(1)},${((1 - y) * SIZE).toFixed(1)}`).join('')
  }, [points])

  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const k = (SIZE + PAD * 2) / r.width
    return { x: clamp01(((e.clientX - r.left) * k - PAD) / SIZE), y: clamp01(1 - ((e.clientY - r.top) * k - PAD) / SIZE) }
  }
  const withChannel = (next: CurvePoint[]): Curves => ({ ...curves, [channel]: next })

  const startDrag = (index: number, e: React.PointerEvent) => {
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    drag.current = index
    onBegin()
  }

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || points.length >= 16) return
    const p = at(e)
    const next = [...points, p].sort((a, b) => a.x - b.x)
    const index = next.indexOf(p)
    if (index === 0 || index === next.length - 1) return
    svg.current!.setPointerCapture(e.pointerId)
    drag.current = index
    onBegin()
    onTransient(withChannel(next))
  }

  const onMove = (e: React.PointerEvent) => {
    const i = drag.current
    if (i === null) return
    const p = at(e)
    const next = points.map((q) => ({ ...q }))
    const last = next.length - 1
    // Endpoints stay at the edges; inner points stay between their neighbours.
    next[i] = { x: i === 0 ? 0 : i === last ? 1 : Math.min(next[i + 1].x - 0.01, Math.max(next[i - 1].x + 0.01, p.x)), y: p.y }
    onTransient(withChannel(next))
  }

  const onUp = () => {
    if (drag.current === null) return
    drag.current = null
    onEnd()
  }

  return (
    <>
      <Segmented<Channel>
        value={channel}
        onChange={setChannel}
        block
        options={(['master', 'r', 'g', 'b'] as Channel[]).map((k) => ({ value: k, label: labels.channel[k] }))}
      />
      <svg
        ref={svg}
        className={s.curves}
        viewBox={`${-PAD} ${-PAD} ${SIZE + PAD * 2} ${SIZE + PAD * 2}`}
        role="img"
        aria-label={labels.title}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f} className={s.curveGrid}>
            <line x1={f * SIZE} y1={0} x2={f * SIZE} y2={SIZE} />
            <line x1={0} y1={f * SIZE} x2={SIZE} y2={f * SIZE} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className={s.curveRef} />
        <path d={path} fill="none" stroke={STROKE[channel]} strokeWidth={2} />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x * SIZE}
            cy={(1 - p.y) * SIZE}
            r={5}
            className={s.curvePoint}
            data-testid="curve-point"
            onPointerDown={(e) => startDrag(i, e)}
            onDoubleClick={() => i > 0 && i < points.length - 1 && onSet(withChannel(points.filter((_, j) => j !== i)))}
          />
        ))}
      </svg>
      <div className={s.presets}>
        {CURVE_PRESETS.map((pr) => (
          <Button key={pr.id} size="sm" variant="ghost" onClick={() => onSet({ ...curves, master: pr.points })}>
            {labels.preset[pr.id]}
          </Button>
        ))}
      </div>
      <span className={s.hint}>{labels.hint}</span>
    </>
  )
}
