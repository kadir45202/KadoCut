import type { Draft } from 'immer'
import { useRef } from 'react'
import type { Clip, Mask, Project } from '@shared/project/schema'
import type { ViewerGeometry } from '@renderer/core/modules/types'
import { useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { layerFor, type VisualClip } from '@renderer/engine/scene'
import { maskT } from './strings'
import s from './mask.module.css'

type Masked = Extract<Clip, { mask: Mask }>

/** Outline of the mask in media pixels (relative to the mask centre, before rotation). */
function outline(mask: Mask, w: number, h: number): [number, number][] {
  const hw = (mask.width * w) / 2
  const hh = (mask.height * h) / 2
  switch (mask.type) {
    case 'linear': {
      const L = Math.max(w, h) * 2
      return [
        [-L, 0],
        [L, 0]
      ]
    }
    case 'mirror': {
      const L = Math.max(w, h) * 2
      return [[-L, -hh], [L, -hh], [L, hh], [-L, hh], [-L, -hh]]
    }
    case 'circle':
    case 'heart':
    case 'star':
      return Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2
        return [Math.cos(a) * hw, Math.sin(a) * hh] as [number, number]
      })
    default:
      return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]]
  }
}

export function MaskOverlay({ clip, geometry }: { clip: Clip; geometry: ViewerGeometry }) {
  const project = useProject((st) => st.project!)
  const playhead = useEditor((st) => st.playhead)
  const drag = useRef<{ x0: number; y0: number; cx: number; cy: number } | null>(null)
  if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'adjustment') return null
  const layer = layerFor(project, clip as VisualClip, playhead)
  if (!layer) return null
  const mask = (clip as Masked).mask
  const [a, b, c, d, e, f] = layer.matrix
  const k = geometry.scale
  // Media pixel → screen pixel.
  const toScreen = (mx: number, my: number): [number, number] => [(a * mx + c * my + e) * k, (b * mx + d * my + f) * k]
  const ox = (0.5 + mask.cx) * layer.width
  const oy = (0.5 + mask.cy) * layer.height
  const rot = (mask.rotation * Math.PI) / 180
  const pts = outline(mask, layer.width, layer.height).map(([x, y]) =>
    toScreen(ox + x * Math.cos(rot) - y * Math.sin(rot), oy + x * Math.sin(rot) + y * Math.cos(rot))
  )
  const [hx, hy] = toScreen(ox, oy)
  const det = a * d - b * c

  const onDown = (ev: React.PointerEvent) => {
    ev.stopPropagation()
    ;(ev.currentTarget as Element).setPointerCapture(ev.pointerId)
    drag.current = { x0: ev.clientX, y0: ev.clientY, cx: mask.cx, cy: mask.cy }
    projectActions.begin()
  }
  const onMove = (ev: React.PointerEvent) => {
    const dr = drag.current
    if (!dr || Math.abs(det) < 1e-9) return
    // Screen delta → media delta through the inverse layer matrix.
    const dx = (ev.clientX - dr.x0) / k
    const dy = (ev.clientY - dr.y0) / k
    const mx = (d * dx - c * dy) / det
    const my = (-b * dx + a * dy) / det
    projectActions.transient((draft) => {
      const target = (draft as Project).clips[clip.id] as Draft<Masked> | undefined
      if (!target) return
      target.mask.cx = Math.round((dr.cx + mx / layer.width) * 1000) / 1000
      target.mask.cy = Math.round((dr.cy + my / layer.height) * 1000) / 1000
    })
  }
  const onUp = () => {
    if (!drag.current) return
    drag.current = null
    projectActions.end(maskT('move'), 'mask')
  }

  return (
    <svg className={s.overlay}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} className={s.outline} />
      <circle cx={hx} cy={hy} r={7} className={s.handle} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
    </svg>
  )
}
