import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Copy, Plus, Scan, SplitSquareHorizontal, Trash2, TriangleAlert } from 'lucide-react'
import type { Photo, PhotoDevelop } from '@shared/photo'
import { photoActions, usePhotos, visiblePhotos } from '@renderer/core/store/photos'
import { cropCorners, dragCrop, type CropHandle } from '@renderer/engine/photo/crop'
import { PhotoRenderer, croppedSize } from '@renderer/engine/photo/develop'
import { loadPhotoBitmap, requestThumb, useThumbs } from '@renderer/engine/photo/images'
import { FULL_VIEW, zoomView } from '@renderer/engine/photo/masks'
import { BUILTIN_PRESETS, applyPreset } from '@renderer/engine/photo/presets'
import { useT } from '@renderer/i18n'
import { log } from '@renderer/lib/api'
import { Button, IconButton, TextInput } from '@renderer/ui/controls'
import { ErrorCard } from '@renderer/ui/layout'
import { DevelopPanel } from './DevelopPanel'
import { measureHistogram } from './Histogram'
import { MaskOverlay } from './MaskOverlay'
import { FlagIcon, Stars } from './Stars'
import { useDevelopUi } from './developUi'
import s from './photos.module.css'

/** Preview resolution cap (export always renders from the full-size original). */
const PREVIEW_EDGE = 3000
const NO_PRESETS: never[] = []

function Preview({ photo }: { photo: Photo }) {
  const t = useT()
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const renderer = useRef<PhotoRenderer | null>(null)
  /** Bumped after every upload of the photo (also when the full size arrives for 1:1). */
  const [ready, setReady] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // The preview-sized copy is enough until 1:1 is used; then the full photo is loaded once.
  const [edge, setEdge] = useState(PREVIEW_EDGE)
  const pan = useRef<{ x: number; y: number; center: [number, number] } | null>(null)
  const { before, cropping, hover, mask, overlay, clip, zoom, center } = useDevelopUi()

  useEffect(() => {
    try {
      renderer.current = new PhotoRenderer(canvas.current!)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    return () => {
      renderer.current?.dispose()
      renderer.current = null
    }
  }, [])

  useEffect(() => {
    if (zoom && renderer.current) setEdge((e) => Math.max(e, renderer.current!.maxSize))
  }, [zoom])
  const sourceEdge = Math.min(edge, Math.max(photo.width, photo.height))

  // Decode the photo once per photo and size (not per edit).
  useEffect(() => {
    let live = true
    const r = renderer.current
    if (!r) return
    loadPhotoBitmap(photo, Math.min(sourceEdge, r.maxSize))
      .then((bmp) => {
        if (!live) return bmp.close()
        r.setImage(bmp, bmp.width, bmp.height)
        bmp.close()
        setReady((n) => n + 1)
      })
      .catch((err) => {
        log.warn('photos', `preview load failed: ${String(err)}`)
        if (live) setError(String(err))
      })
    return () => {
      live = false
    }
  }, [photo.id, photo.path, photo.preview, sourceEdge])

  useLayoutEffect(() => {
    const el = wrap.current
    if (!el) return
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const develop: PhotoDevelop = hover ? applyPreset(photo.develop, hover) : photo.develop
  const dpr = window.devicePixelRatio || 1
  const full = useMemo(() => croppedSize(photo.width, photo.height, develop.crop), [photo.width, photo.height, develop.crop])
  // On-screen size: the crop (or the whole frame while cropping) fitted into the area, or a 1:1 window.
  const view = useMemo(() => {
    const pad = 24
    if (zoom && !cropping) {
      const w = Math.max(1, Math.floor(Math.min(box.w, full.width / dpr)))
      const h = Math.max(1, Math.floor(Math.min(box.h, full.height / dpr)))
      return { w, h, scale: 1 / dpr, rect: zoomView(center[0], center[1], (w * dpr) / full.width, (h * dpr) / full.height) }
    }
    const size = cropping ? { width: photo.width, height: photo.height } : full
    const k = Math.min((box.w - pad * 2) / size.width, (box.h - pad * 2) / size.height)
    return { w: Math.max(1, Math.floor(size.width * k)), h: Math.max(1, Math.floor(size.height * k)), scale: k, rect: FULL_VIEW }
  }, [box, photo.width, photo.height, full, cropping, zoom, center, dpr])
  const editing = !cropping && !before ? develop.masks.find((m) => m.id === mask) : undefined

  useEffect(() => {
    const r = renderer.current
    if (!r || !ready || view.w < 2) return
    const overlayIndex = editing && overlay ? develop.masks.indexOf(editing) : -1
    r.render(develop, Math.round(view.w * dpr), Math.round(view.h * dpr), { neutral: before, uncropped: cropping, view: view.rect, clip, overlay: overlayIndex })
    // The histogram always describes the whole photo, without warnings or overlays.
    const hw = 200
    const hh = Math.max(1, Math.round((hw * view.h * view.rect.w) / (view.w * view.rect.h)))
    const px = r.pixels(develop, hw, hh, { neutral: before, uncropped: cropping })
    if (px) measureHistogram(px)
  }, [develop, before, cropping, view, ready, clip, overlay, editing, dpr])

  const panTo = (cx: number, cy: number) => {
    const r = zoomView(cx, cy, view.rect.w, view.rect.h)
    useDevelopUi.setState({ center: [r.x + r.w / 2, r.y + r.h / 2] })
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (!zoom || cropping || e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    pan.current = { x: e.clientX, y: e.clientY, center: [view.rect.x + view.rect.w / 2, view.rect.y + view.rect.h / 2] }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current
    if (!p) return
    panTo(p.center[0] - ((e.clientX - p.x) / view.w) * view.rect.w, p.center[1] - ((e.clientY - p.y) / view.h) * view.rect.h)
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!zoom || cropping) return
    const cx = view.rect.x + view.rect.w / 2
    const cy = view.rect.y + view.rect.h / 2
    const dx = e.shiftKey ? e.deltaY : e.deltaX
    const dy = e.shiftKey ? 0 : e.deltaY
    panTo(cx + (dx / view.w) * view.rect.w, cy + (dy / view.h) * view.rect.h)
  }
  // Double-click switches between fit and 1:1 at the clicked point.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (cropping || editing?.kind === 'brush') return
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const u = view.rect.x + ((e.clientX - b.left) / b.width) * view.rect.w
    const v = view.rect.y + ((e.clientY - b.top) / b.height) * view.rect.h
    useDevelopUi.setState({ zoom: !zoom, center: zoom ? [0.5, 0.5] : [u, v] })
  }

  if (error) return <ErrorCard title={t('photo.previewFailed')} message={error} />
  return (
    <div ref={wrap} className={s.previewArea} onWheel={onWheel}>
      <div
        className={s.previewBox}
        style={{ width: view.w, height: view.h }}
        data-zoom={zoom && !cropping}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (pan.current = null)}
        onPointerCancel={() => (pan.current = null)}
        onDoubleClick={onDoubleClick}
      >
        <canvas ref={canvas} className={s.previewCanvas} style={{ width: view.w, height: view.h }} data-testid="photo-preview" />
        {cropping && ready > 0 && <CropOverlay photo={photo} scale={view.scale} width={view.w} height={view.h} />}
        {editing && ready > 0 && <MaskOverlay photo={photo} develop={develop} mask={editing} width={view.w} height={view.h} rect={view.rect} k={view.w / (view.rect.w * full.width)} />}
        {before && <span className={s.beforeBadge}>{t('photo.before')}</span>}
        {zoom && !cropping && <span className={s.zoomBadge} data-testid="zoom-badge">1:1</span>}
      </div>
      {!ready && <span className={s.loading}>{t('photo.loading')}</span>}
    </div>
  )
}

const HANDLES: { id: CropHandle; at: (c: [number, number][]) => [number, number] }[] = [
  { id: 'nw', at: (c) => c[0] },
  { id: 'ne', at: (c) => c[1] },
  { id: 'se', at: (c) => c[2] },
  { id: 'sw', at: (c) => c[3] },
  { id: 'n', at: (c) => [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2] },
  { id: 'e', at: (c) => [(c[1][0] + c[2][0]) / 2, (c[1][1] + c[2][1]) / 2] },
  { id: 's', at: (c) => [(c[2][0] + c[3][0]) / 2, (c[2][1] + c[3][1]) / 2] },
  { id: 'w', at: (c) => [(c[3][0] + c[0][0]) / 2, (c[3][1] + c[0][1]) / 2] }
]

/** Crop rectangle over the whole (uncropped) frame: drag inside to move, handles to resize. */
function CropOverlay({ photo, scale, width, height }: { photo: Photo; scale: number; width: number; height: number }) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ handle: CropHandle; from: [number, number]; start: PhotoDevelop['crop'] } | null>(null)
  const W = photo.width
  const H = photo.height
  const corners = cropCorners(photo.develop.crop, W, H).map(([x, y]) => [x * scale, y * scale] as [number, number])
  const poly = corners.map((p) => p.join(',')).join(' ')
  const toSource = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale]
  }
  const start = (handle: CropHandle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    drag.current = { handle, from: toSource(e), start: photo.develop.crop }
    photoActions.begin(photo.id)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const next = dragCrop(d.start, d.handle, d.from, toSource(e), W, H)
    photoActions.transient(photo.id, (dev) => void (dev.crop = next))
  }
  const end = () => {
    if (!drag.current) return
    drag.current = null
    photoActions.end(photo.id)
  }
  // Thirds lines inside the turned rectangle.
  const lerp = (a: [number, number], b: [number, number], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  const thirds = [1 / 3, 2 / 3].flatMap((k) => [
    [lerp(corners[0], corners[1], k), lerp(corners[3], corners[2], k)],
    [lerp(corners[0], corners[3], k), lerp(corners[1], corners[2], k)]
  ])
  return (
    <svg ref={svg} className={s.cropOverlay} width={width} height={height} onPointerMove={move} onPointerUp={end} onPointerCancel={end} data-testid="crop-overlay">
      <defs>
        <mask id="crop-hole">
          <rect width={width} height={height} fill="white" />
          <polygon points={poly} fill="black" />
        </mask>
      </defs>
      <rect width={width} height={height} className={s.cropShade} mask="url(#crop-hole)" />
      <polygon points={poly} className={s.cropBox} onPointerDown={start('move')} />
      {thirds.map(([a, b], i) => (
        <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={s.cropThird} />
      ))}
      {HANDLES.map((h) => {
        const [x, y] = h.at(corners)
        return <rect key={h.id} x={x - 6} y={y - 6} width={12} height={12} rx={2} className={s.cropHandle} data-handle={h.id} onPointerDown={start(h.id)} />
      })}
    </svg>
  )
}

function Presets({ photo }: { photo: Photo }) {
  const t = useT()
  const presets = usePhotos((st) => st.catalog?.presets ?? NO_PRESETS)
  const [name, setName] = useState('')
  const item = (key: string, label: string, develop: Partial<PhotoDevelop>, onDelete?: () => void) => (
    <div key={key} className={s.presetRow}>
      <button
        type="button"
        className={s.preset}
        onMouseEnter={() => useDevelopUi.setState({ hover: develop })}
        onMouseLeave={() => useDevelopUi.setState({ hover: null })}
        onClick={() => {
          useDevelopUi.setState({ hover: null })
          photoActions.applyPreset([photo.id], develop)
        }}
      >
        {label}
      </button>
      {onDelete && (
        <IconButton small label={t('photo.presetDelete')} onClick={onDelete}>
          <Trash2 />
        </IconButton>
      )}
    </div>
  )
  return (
    <aside className={s.presets}>
      <span className={s.sideTitle}>{t('photo.presets')}</span>
      {BUILTIN_PRESETS.map((p) => item(p.id, t(`photo.preset.${p.id}`), p.develop))}
      {presets.length > 0 && <span className={s.sideTitle}>{t('photo.myPresets')}</span>}
      {presets.map((p) => item(p.id, p.name, p.develop, () => photoActions.deletePreset(p.id)))}
      <div className={s.savePreset}>
        <TextInput value={name} placeholder={t('photo.presetName')} aria-label={t('photo.presetName')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <IconButton
          label={t('photo.presetSave')}
          disabled={!name.trim()}
          onClick={() => {
            photoActions.savePreset(name.trim(), photo.develop)
            setName('')
          }}
        >
          <Plus />
        </IconButton>
      </div>
      <span className={s.hint}>{t('photo.presetHint')}</span>
      <Snapshots photo={photo} />
    </aside>
  )
}

/** Named saved states of this photo (Lightroom snapshots). */
function Snapshots({ photo }: { photo: Photo }) {
  const t = useT()
  const [name, setName] = useState('')
  const save = () => {
    const at = new Date()
    photoActions.saveSnapshot(photo.id, name.trim() || t('photo.snapshotDefault', { time: at.toLocaleString() }))
    setName('')
  }
  return (
    <>
      <span className={s.sideTitle}>{t('photo.snapshots')}</span>
      {photo.snapshots.map((snap) => (
        <div key={snap.id} className={s.presetRow}>
          <button type="button" className={s.preset} title={new Date(snap.at).toLocaleString()} data-testid="snapshot-item" onClick={() => photoActions.applySnapshot(photo.id, snap.id)}>
            {snap.name}
          </button>
          <IconButton small label={t('photo.snapshotDelete')} onClick={() => photoActions.deleteSnapshot(photo.id, snap.id)}>
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <div className={s.savePreset}>
        <TextInput
          value={name}
          placeholder={t('photo.snapshotName')}
          aria-label={t('photo.snapshotName')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') save()
          }}
        />
        <IconButton label={t('photo.snapshotSave')} onClick={save}>
          <Camera />
        </IconButton>
      </div>
      <span className={s.hint}>{t('photo.snapshotHint')}</span>
    </>
  )
}

function Filmstrip() {
  const state = usePhotos()
  const list = visiblePhotos(state)
  const urls = useThumbs((st) => st.urls)
  useEffect(() => list.forEach(requestThumb), [list])
  return (
    <div className={s.filmstrip}>
      {list.map((p) => (
        <button
          key={p.id}
          type="button"
          className={s.filmItem}
          data-current={p.id === state.currentId}
          title={p.name}
          onClick={() => usePhotos.setState({ currentId: p.id, selection: [p.id] })}
        >
          {urls[p.id] ? <img src={urls[p.id]} alt="" draggable={false} /> : <span className={s.thumbEmpty} />}
        </button>
      ))}
    </div>
  )
}

export function Develop() {
  const t = useT()
  const currentId = usePhotos((st) => st.currentId)
  const photo = usePhotos((st) => st.catalog?.photos.find((p) => p.id === st.currentId))
  const { before, clip, zoom } = useDevelopUi()
  const canUndo = usePhotos((st) => !!(currentId && st.history[currentId]?.past.length))
  if (!photo) return <div className={s.emptyDevelop}>{t('photo.pickOne')}</div>
  return (
    <div className={s.developLayout}>
      <Presets photo={photo} />
      <div className={s.center}>
        <Preview key={photo.id} photo={photo} />
        <div className={s.developBar}>
          <IconButton label={t('photo.prev')} onClick={() => photoActions.step(-1)}>
            <ChevronLeft />
          </IconButton>
          <Stars value={photo.rating} onChange={(v) => photoActions.setRating([photo.id], v)} />
          <FlagIcon flag={photo.flag} />
          <Button size="sm" variant={before ? 'primary' : 'secondary'} icon={<SplitSquareHorizontal />} onClick={() => useDevelopUi.setState({ before: !before })}>
            {t('photo.beforeAfter')} (\)
          </Button>
          <Button size="sm" variant={zoom ? 'primary' : 'secondary'} icon={<Scan />} onClick={() => useDevelopUi.setState({ zoom: !zoom, center: [0.5, 0.5] })}>
            1:1 (Z)
          </Button>
          <Button size="sm" variant={clip ? 'primary' : 'secondary'} icon={<TriangleAlert />} onClick={() => useDevelopUi.setState({ clip: !clip })}>
            {t('photo.clipping')} (J)
          </Button>
          <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => photoActions.virtualCopy(photo.id)}>
            {t('photo.virtualCopy')}
          </Button>
          <Button size="sm" variant="ghost" disabled={!canUndo} onClick={() => photoActions.undo(photo.id)}>
            {t('photo.undo')}
          </Button>
          <IconButton label={t('photo.next')} onClick={() => photoActions.step(1)}>
            <ChevronRight />
          </IconButton>
        </div>
        <Filmstrip />
      </div>
      <DevelopPanel photo={photo} />
    </div>
  )
}
