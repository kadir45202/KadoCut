import type { Draft } from 'immer'
import { useRef } from 'react'
import type { Clip, Crop, ImageClip, Project, VideoClip } from '@shared/project/schema'
import type { ViewerGeometry } from '@renderer/core/modules/types'
import { useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { layerFor } from '@renderer/engine/scene'
import { cropT } from './strings'
import { useCropMode } from './mode'
import s from './crop.module.css'

type Visual = VideoClip | ImageClip
type Edge = 'left' | 'top' | 'right' | 'bottom'
/** Handles: the edges each one moves. */
const HANDLES: { edges: Edge[]; u: number; v: number; cursor: string }[] = [
  { edges: ['left', 'top'], u: 0, v: 0, cursor: 'nwse-resize' },
  { edges: ['top'], u: 0.5, v: 0, cursor: 'ns-resize' },
  { edges: ['right', 'top'], u: 1, v: 0, cursor: 'nesw-resize' },
  { edges: ['right'], u: 1, v: 0.5, cursor: 'ew-resize' },
  { edges: ['right', 'bottom'], u: 1, v: 1, cursor: 'nwse-resize' },
  { edges: ['bottom'], u: 0.5, v: 1, cursor: 'ns-resize' },
  { edges: ['left', 'bottom'], u: 0, v: 1, cursor: 'nesw-resize' },
  { edges: ['left'], u: 0, v: 0.5, cursor: 'ew-resize' }
]
const MAX_TOTAL = 0.95

/** On-canvas crop: dashed full frame plus draggable edges/corners of the kept area. */
export function CropOverlay({ clip, geometry }: { clip: Clip; geometry: ViewerGeometry }) {
  const project = useProject((st) => st.project!)
  const playhead = useEditor((st) => st.playhead)
  const drag = useRef<{ edges: Edge[]; x0: number; y0: number; crop: Crop } | null>(null)
  const editing = useCropMode((st) => st.clipId === clip.id)
  const layer = layerFor(project, clip as Visual, playhead)
  if (!layer || !editing) return null
  const crop = (clip as Visual).crop
  const [a, b, c, d, e, f] = layer.matrix
  const k = geometry.scale
  const toScreen = (u: number, v: number) => [(a * u * layer.width + c * v * layer.height + e) * k, (b * u * layer.width + d * v * layer.height + f) * k]
  const poly = (u0: number, v0: number, u1: number, v1: number) =>
    [toScreen(u0, v0), toScreen(u1, v0), toScreen(u1, v1), toScreen(u0, v1)].map((p) => p.join(',')).join(' ')
  const x0 = crop.left
  const y0 = crop.top
  const x1 = 1 - crop.right
  const y1 = 1 - crop.bottom
  const det = a * d - b * c

  const onMove = (ev: React.PointerEvent) => {
    const dr = drag.current
    if (!dr || Math.abs(det) < 1e-9) return
    const dx = (ev.clientX - dr.x0) / k
    const dy = (ev.clientY - dr.y0) / k
    // Screen delta → fraction of the media frame through the inverse layer matrix.
    const du = (d * dx - c * dy) / det / layer.width
    const dv = (-b * dx + a * dy) / det / layer.height
    const next = { ...dr.crop }
    const clamp = (v: number, other: number) => Math.min(MAX_TOTAL - other, Math.max(0, v))
    if (dr.edges.includes('left')) next.left = clamp(dr.crop.left + du, next.right)
    if (dr.edges.includes('right')) next.right = clamp(dr.crop.right - du, next.left)
    if (dr.edges.includes('top')) next.top = clamp(dr.crop.top + dv, next.bottom)
    if (dr.edges.includes('bottom')) next.bottom = clamp(dr.crop.bottom - dv, next.top)
    projectActions.transient((draft) => {
      const target = (draft as Project).clips[clip.id] as Draft<Visual> | undefined
      if (target) Object.assign(target.crop, { left: next.left, right: next.right, top: next.top, bottom: next.bottom })
    })
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    projectActions.end(cropT('edit'), 'crop')
  }

  return (
    <svg className={s.overlay} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {/* Swallow clicks so other handles underneath don't react while cropping. */}
      <rect width="100%" height="100%" className={s.shield} />
      <polygon points={poly(0, 0, 1, 1)} className={s.frame} />
      <polygon points={poly(x0, y0, x1, y1)} className={s.kept} />
      {HANDLES.map((h, i) => {
        const [hx, hy] = toScreen(x0 + (x1 - x0) * h.u, y0 + (y1 - y0) * h.v)
        return (
          <rect
            key={i}
            x={hx - 6}
            y={hy - 6}
            width={12}
            height={12}
            rx={2}
            className={s.handle}
            style={{ cursor: h.cursor }}
            onPointerDown={(ev) => {
              ev.stopPropagation()
              ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
              drag.current = { edges: h.edges, x0: ev.clientX, y0: ev.clientY, crop: { ...crop } }
              projectActions.begin()
            }}
          />
        )
      })}
    </svg>
  )
}
