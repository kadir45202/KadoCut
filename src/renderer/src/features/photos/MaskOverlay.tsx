import { useRef, useState } from 'react'
import type { Photo, PhotoDevelop, PhotoMask } from '@shared/photo'
import { photoActions } from '@renderer/core/store/photos'
import { frameToView, viewToFrame, type ViewRect } from '@renderer/engine/photo/masks'
import { useDevelopUi } from './developUi'
import s from './photos.module.css'

type Pt = [number, number]
type Handle = 'move' | 'rx' | 'ry' | 'a' | 'b'

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const rotate = ([x, y]: Pt, deg: number): Pt => {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

interface Props {
  photo: Photo
  develop: PhotoDevelop
  mask: PhotoMask
  /** Canvas size on screen (CSS pixels). */
  width: number
  height: number
  rect: ViewRect
  /** Screen pixels per photo pixel. */
  k: number
}

/** Handles of the mask being edited, drawn over the photo: brush painting, radial and linear gradients. */
export function MaskOverlay({ photo, develop, mask, width, height, rect, k }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ handle: Handle; from: Pt; start: PhotoMask } | null>(null)
  const painting = useRef<Pt | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const brush = useDevelopUi((st) => st.brush)
  const W = photo.width
  const H = photo.height
  const L = Math.max(W, H)
  const crop = develop.crop
  const toScreen = (x: number, y: number): Pt => {
    const [u, v] = frameToView(x, y, crop, rect, W, H)
    return [u * width, v * height]
  }
  const toFrame = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect()
    return viewToFrame((e.clientX - r.left) / width, (e.clientY - r.top) / height, crop, rect, W, H)
  }
  const local = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const update = (recipe: (m: PhotoMask) => void) =>
    photoActions.transient(photo.id, (d) => {
      const m = d.masks.find((x) => x.id === mask.id)
      if (m) recipe(m as PhotoMask)
    })

  const startDrag = (handle: Handle) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { handle, from: toFrame(e), start: mask }
    photoActions.begin(photo.id)
  }

  const onMove = (e: React.PointerEvent) => {
    if (mask.kind === 'brush') {
      setCursor(local(e))
      const last = painting.current
      if (!last) return
      const p = toFrame(e)
      // A point every fifth of the radius is smooth enough and keeps the catalog small.
      if (Math.hypot((p[0] - last[0]) * W, (p[1] - last[1]) * H) < brush.size * L * 0.2) return
      painting.current = p
      update((m) => {
        if (m.kind === 'brush') m.strokes[m.strokes.length - 1]?.points.push(r4(p[0]), r4(p[1]))
      })
      return
    }
    const d = drag.current
    if (!d) return
    const p = toFrame(e)
    const dx = p[0] - d.from[0]
    const dy = p[1] - d.from[1]
    const st = d.start
    update((m) => {
      if (m.kind === 'radial' && st.kind === 'radial') {
        if (d.handle === 'move') Object.assign(m, { cx: r4(st.cx + dx), cy: r4(st.cy + dy) })
        else {
          // Radius from the pointer's distance along the ellipse's own axis.
          const [lx, ly] = rotate([(p[0] - st.cx) * W, (p[1] - st.cy) * H], -st.angle)
          if (d.handle === 'rx') m.rx = Math.min(2, Math.max(0.005, r4(Math.abs(lx) / L)))
          else m.ry = Math.min(2, Math.max(0.005, r4(Math.abs(ly) / L)))
        }
      } else if (m.kind === 'linear' && st.kind === 'linear') {
        if (d.handle === 'move' || d.handle === 'a') Object.assign(m, { x0: r4(st.x0 + dx), y0: r4(st.y0 + dy) })
        if (d.handle === 'move' || d.handle === 'b') Object.assign(m, { x1: r4(st.x1 + dx), y1: r4(st.y1 + dy) })
      }
    })
  }

  const onDown = (e: React.PointerEvent) => {
    if (mask.kind !== 'brush' || e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const p = toFrame(e)
    const erase = brush.erase || e.altKey
    photoActions.begin(photo.id)
    update((m) => {
      if (m.kind === 'brush') m.strokes.push({ size: brush.size, feather: brush.feather, erase, points: [r4(p[0]), r4(p[1])] })
    })
    painting.current = p
  }

  const onUp = () => {
    if (!drag.current && !painting.current) return
    drag.current = null
    painting.current = null
    photoActions.end(photo.id)
  }

  let body: React.ReactNode = null
  if (mask.kind === 'radial') {
    const c = toScreen(mask.cx, mask.cy)
    const rx = mask.rx * L * k
    const ry = mask.ry * L * k
    const rot = mask.angle - crop.angle
    const ex = rotate([rx, 0], rot)
    const ey = rotate([0, ry], rot)
    const inner = 1 - mask.feather
    body = (
      <>
        <ellipse cx={c[0]} cy={c[1]} rx={rx} ry={ry} transform={`rotate(${rot} ${c[0]} ${c[1]})`} className={s.maskLine} />
        {inner > 0.02 && <ellipse cx={c[0]} cy={c[1]} rx={rx * inner} ry={ry * inner} transform={`rotate(${rot} ${c[0]} ${c[1]})`} className={s.maskLineSoft} />}
        <circle cx={c[0]} cy={c[1]} r={7} className={s.maskHandle} data-handle="move" onPointerDown={startDrag('move')} />
        <rect x={c[0] + ex[0] - 5} y={c[1] + ex[1] - 5} width={10} height={10} rx={2} className={s.maskHandle} data-handle="rx" onPointerDown={startDrag('rx')} />
        <rect x={c[0] + ey[0] - 5} y={c[1] + ey[1] - 5} width={10} height={10} rx={2} className={s.maskHandle} data-handle="ry" onPointerDown={startDrag('ry')} />
      </>
    )
  } else if (mask.kind === 'linear') {
    const a = toScreen(mask.x0, mask.y0)
    const b = toScreen(mask.x1, mask.y1)
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    // Lines across the photo, perpendicular to the gradient.
    const n: Pt = [((a[1] - b[1]) / len) * 4000, ((b[0] - a[0]) / len) * 4000]
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    body = (
      <>
        <line x1={a[0] - n[0]} y1={a[1] - n[1]} x2={a[0] + n[0]} y2={a[1] + n[1]} className={s.maskLine} />
        <line x1={m[0] - n[0]} y1={m[1] - n[1]} x2={m[0] + n[0]} y2={m[1] + n[1]} className={s.maskLineSoft} />
        <line x1={b[0] - n[0]} y1={b[1] - n[1]} x2={b[0] + n[0]} y2={b[1] + n[1]} className={s.maskLine} />
        <circle cx={a[0]} cy={a[1]} r={6} className={s.maskHandle} data-handle="a" onPointerDown={startDrag('a')} />
        <circle cx={m[0]} cy={m[1]} r={7} className={s.maskHandle} data-handle="move" onPointerDown={startDrag('move')} />
        <circle cx={b[0]} cy={b[1]} r={6} className={s.maskHandle} data-handle="b" onPointerDown={startDrag('b')} />
      </>
    )
  } else {
    const r = brush.size * L * k
    body = (
      <>
        <rect width={width} height={height} className={s.brushArea} data-testid="brush-area" onPointerDown={onDown} />
        {cursor && <circle cx={cursor[0]} cy={cursor[1]} r={r} className={s.brushCursor} />}
        {cursor && brush.feather > 0.02 && <circle cx={cursor[0]} cy={cursor[1]} r={r * (1 - brush.feather)} className={s.brushCursorInner} />}
      </>
    )
  }

  return (
    <svg
      ref={svg}
      className={s.maskOverlay}
      width={width}
      height={height}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setCursor(null)}
      data-testid="mask-overlay"
    >
      {body}
    </svg>
  )
}
