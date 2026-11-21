import { useRef, useState } from 'react'
import type { Clip, CompoundClip, Project, Transform } from '@shared/project/schema'
import type { ViewerGeometry } from '@renderer/core/modules/types'
import { evalAnimated, setAnimatedValue } from '@renderer/core/project/keyframes'
import { useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { layerCorners, layerFor, type VisualClip } from '@renderer/engine/scene'
import { transformT } from './strings'
import s from './transform.module.css'

type Mode = 'move' | 'scale' | 'rotate'

interface DragStart {
  mode: Mode
  x0: number
  y0: number
  /** Layer centre in screen pixels (relative to the overlay). */
  cx: number
  cy: number
  values: { x: number; y: number; scale: number; rotation: number }
  local: number
  /** Screen-space bounding box of the layer at drag start. */
  box: { x0: number; x1: number; y0: number; y1: number }
}

/** Closest snap of any edge to any target within SNAP_PX (screen pixels). */
function snapAxis(edges: number[], targets: number[]): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null
  for (const edge of edges) {
    for (const at of targets) {
      const delta = at - edge
      if (Math.abs(delta) < SNAP_PX && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, at }
    }
  }
  return best
}

const SNAP_PX = 8

/** Bounding box with move / scale / rotate handles over the viewer. */
export function TransformOverlay({ clip, geometry }: { clip: Clip; geometry: ViewerGeometry }) {
  const project = useProject((st) => st.project!)
  const playhead = useEditor((st) => st.playhead)
  const root = useRef<SVGSVGElement>(null)
  const drag = useRef<DragStart | null>(null)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] })
  if (clip.kind === 'audio') return null

  const layer = layerFor(project, clip as VisualClip | CompoundClip, playhead)
  if (!layer) return null
  const k = geometry.scale
  const pts = layerCorners(layer).map(([x, y]) => [x * k, y * k] as const)
  const cx = (pts[0][0] + pts[2][0]) / 2
  const cy = (pts[0][1] + pts[2][1]) / 2
  // Rotation handle sits above the top edge's midpoint.
  const tx = (pts[0][0] + pts[1][0]) / 2
  const ty = (pts[0][1] + pts[1][1]) / 2
  const nx = tx - cx
  const ny = ty - cy
  const len = Math.hypot(nx, ny) || 1
  const rx = tx + (nx / len) * 26
  const ry = ty + (ny / len) * 26

  const start = (mode: Mode) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const tr = (clip as Extract<Clip, { transform: Transform }>).transform
    const local = Math.min(Math.max(playhead - clip.start, 0), clip.duration)
    const rect = root.current!.getBoundingClientRect()
    drag.current = {
      mode,
      x0: e.clientX - rect.left,
      y0: e.clientY - rect.top,
      cx,
      cy,
      local,
      box: {
        x0: Math.min(...pts.map((p) => p[0])),
        x1: Math.max(...pts.map((p) => p[0])),
        y0: Math.min(...pts.map((p) => p[1])),
        y1: Math.max(...pts.map((p) => p[1]))
      },
      values: {
        x: evalAnimated(tr.x, local),
        y: evalAnimated(tr.y, local),
        scale: evalAnimated(tr.scale, local),
        rotation: evalAnimated(tr.rotation, local)
      }
    }
    projectActions.begin()
  }

  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const rect = root.current!.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const { width: cw, height: ch } = geometry
    const write = (key: keyof Transform, v: number) => (draft: Project) => {
      const c = draft.clips[clip.id] as Extract<Clip, { transform: Transform }> | undefined
      if (c) c.transform[key] = setAnimatedValue(c.transform[key], d.local, v)
    }
    if (d.mode === 'move') {
      let x = d.values.x + (px - d.x0) / k / cw
      let y = d.values.y + (py - d.y0) / k / ch
      // Smart guides: the layer's edges or centre snap to the canvas edges, thirds and centre
      // (hold Alt to move freely).
      const next = { v: [] as number[], h: [] as number[] }
      if (!e.altKey) {
        const W = cw * k
        const H = ch * k
        const dx = (x - d.values.x) * W
        const dy = (y - d.values.y) * H
        const sx = snapAxis([d.box.x0 + dx, (d.box.x0 + d.box.x1) / 2 + dx, d.box.x1 + dx], [0, W / 3, W / 2, (2 * W) / 3, W])
        const sy = snapAxis([d.box.y0 + dy, (d.box.y0 + d.box.y1) / 2 + dy, d.box.y1 + dy], [0, H / 3, H / 2, (2 * H) / 3, H])
        if (sx) {
          x += sx.delta / W
          next.v.push(sx.at)
        }
        if (sy) {
          y += sy.delta / H
          next.h.push(sy.at)
        }
      }
      setGuides(next)
      projectActions.transient((draft) => {
        write('x', x)(draft as Project)
        write('y', y)(draft as Project)
      })
    } else if (d.mode === 'scale') {
      const r0 = Math.hypot(d.x0 - d.cx, d.y0 - d.cy) || 1
      const r1 = Math.hypot(px - d.cx, py - d.cy)
      const scale = Math.max(0.01, Math.round(d.values.scale * (r1 / r0) * 1000) / 1000)
      projectActions.transient((draft) => write('scale', scale)(draft as Project))
    } else {
      const a0 = Math.atan2(d.y0 - d.cy, d.x0 - d.cx)
      const a1 = Math.atan2(py - d.cy, px - d.cx)
      let rotation = d.values.rotation + ((a1 - a0) * 180) / Math.PI
      if (e.shiftKey) rotation = Math.round(rotation / 15) * 15
      projectActions.transient((draft) => write('rotation', Math.round(rotation * 10) / 10)(draft as Project))
    }
  }

  const end = () => {
    const d = drag.current
    drag.current = null
    setGuides({ v: [], h: [] })
    if (!d) return
    projectActions.end(d.mode === 'move' ? transformT('move') : d.mode === 'scale' ? transformT('resize') : transformT('rotate'), 'transform')
  }

  const poly = pts.map((p) => p.join(',')).join(' ')
  return (
    <svg ref={root} className={s.overlay} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      {guides.v.map((x) => (
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={geometry.height * k} className={s.guide} />
      ))}
      {guides.h.map((y) => (
        <line key={`h${y}`} x1={0} y1={y} x2={geometry.width * k} y2={y} className={s.guide} />
      ))}
      <polygon points={poly} className={s.box} onPointerDown={start('move')} />
      <line x1={tx} y1={ty} x2={rx} y2={ry} className={s.stem} />
      <circle cx={rx} cy={ry} r={6} className={s.rotate} onPointerDown={start('rotate')} />
      {pts.map(([x, y], i) => (
        <rect key={i} x={x - 5} y={y - 5} width={10} height={10} rx={2} className={s.handle} onPointerDown={start('scale')} />
      ))}
    </svg>
  )
}
