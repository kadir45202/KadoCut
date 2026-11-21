import { ArrowRightLeft, AudioLines, Eye, EyeOff, Film, Lock, LockOpen, Type, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MARKER_COLORS } from '@shared/project/defaults'
import type { Clip, ImageClip, Project, Track, VideoClip } from '@shared/project/schema'
import { addAssetToTimeline, importFiles } from '@renderer/core/media/import'
import { snapToFrame } from '@renderer/core/project/clip'
import { clipFromAsset } from '@renderer/core/project/factory'
import { displayTracks, findOrCreateFreeTrack, isRangeFree, nearestSnap, projectDuration, snapPoints, trackKindFor } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useSettings } from '@renderer/core/store/settings'
import { getPreview, seek } from '@renderer/engine/preview'
import { useT } from '@renderer/i18n'
import { api, pathForFile } from '@renderer/lib/api'
import { ASSET_MIME, FILE_MIME } from '../editor/MediaPanel'
import { ClipView } from './ClipView'
import { computeFade, computeMove, computeTrim, resolveDrop, type DropTarget } from './drag'
import { Ruler } from './Ruler'
import s from './timeline.module.css'

export const HEADER_W = 168
export const RULER_H = 26
const SNAP_PX = 8

export function rowHeight(track: Track): number {
  if (track.main) return 64
  if (track.kind === 'video') return 50
  if (track.kind === 'text') return 32
  return 46
}

interface DragState {
  mode: 'move' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out'
  clipId: string
  ids: string[]
  x0: number
  scroll0: number
  origin: Project
  started: boolean
  target: DropTarget | null
}

export function Timeline() {
  const t = useT()
  const project = useProject((st) => st.project!)
  const pps = useEditor((st) => st.pxPerSec)
  const playhead = useEditor((st) => st.playhead)
  const playing = useEditor((st) => st.playing)
  const selection = useEditor((st) => st.selection)
  const gap = useEditor((st) => st.gap)
  const snapping = useSettings((st) => st.settings.snapping)
  const scroller = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ left: 0, width: 800 })
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const [dropHint, setDropHint] = useState<{ trackId: string | 'new-top' | 'new-audio'; time: number } | null>(null)
  const drag = useRef<DragState | null>(null)

  const tracks = useMemo(() => displayTracks(project), [project])
  const duration = projectDuration(project)
  const contentW = Math.max(view.width, (duration + 30) * pps)
  const selected = useMemo(() => new Set(selection), [selection])

  // Track scroll/size for virtualized drawing of thumbnails and waveforms.
  useLayoutEffect(() => {
    const el = scroller.current!
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setView({ left: el.scrollLeft, width: el.clientWidth - HEADER_W }))
    }
    update()
    el.addEventListener('scroll', update)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = playhead * pps
    if (x > el.scrollLeft + view.width - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40)
  }, [playhead, playing, pps, view.width])

  // Ctrl + wheel zooms around the pointer.
  useEffect(() => {
    const el = scroller.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left - HEADER_W
      const current = useEditor.getState().pxPerSec
      const time = (el.scrollLeft + px) / current
      editorActions.setZoom(current * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
      const next = useEditor.getState().pxPerSec
      el.scrollLeft = Math.max(0, time * next - px)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const timeAt = useCallback((clientX: number) => {
    const el = scroller.current!
    const rect = el.getBoundingClientRect()
    return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / useEditor.getState().pxPerSec)
  }, [])

  /** Track under a client Y coordinate, or a "new track" zone above/below. */
  const targetAt = useCallback(
    (clientY: number, kind: Track['kind']): DropTarget | null => {
      const el = scroller.current!
      const rect = el.getBoundingClientRect()
      let y = clientY - rect.top + el.scrollTop - RULER_H
      if (y < 0) return kind !== 'audio' ? { kind: 'new', trackKind: kind } : null
      for (const track of tracks) {
        const h = rowHeight(track)
        if (y < h) {
          if (track.kind === kind) return { kind: 'track', trackId: track.id }
          // Over a track of another kind: new track of the right kind.
          return { kind: 'new', trackKind: kind }
        }
        y -= h
      }
      return { kind: 'new', trackKind: kind }
    },
    [tracks]
  )

  // ------------------------------------------------------------ clip drag

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip, mode: DragState['mode']) => {
    // Right-click selects the clip so its context menu acts on it.
    if (e.button === 2 && !selected.has(clip.id)) editorActions.select([clip.id])
    if (e.button !== 0) return
    e.stopPropagation()
    const track = project.tracks.find((tr) => tr.id === clip.trackId)
    const additive = e.shiftKey || e.ctrlKey
    if (additive) editorActions.select([clip.id], true)
    else if (!selected.has(clip.id)) editorActions.select([clip.id])
    if (track?.locked) return
    const ids = mode === 'move' ? (selected.has(clip.id) && !additive ? selection : [clip.id]).filter((id) => {
      const tr = project.tracks.find((x) => x.id === project.clips[id]?.trackId)
      return tr && !tr.locked
    }) : [clip.id]
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { mode, clipId: clip.id, ids, x0: e.clientX, scroll0: scroller.current!.scrollLeft, origin: project, started: false, target: null }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0 + (scroller.current!.scrollLeft - d.scroll0)
    if (!d.started) {
      if (Math.abs(dx) < 3 && d.mode !== 'move') return
      if (Math.abs(dx) < 3 && Math.abs(e.movementY) < 3) return
      d.started = true
      projectActions.begin()
    }
    const pxPerSec = useEditor.getState().pxPerSec
    const dt = dx / pxPerSec
    const snapOn = snapping !== e.altKey
    const points = snapOn ? snapPoints(d.origin, useEditor.getState().playhead, new Set(d.ids)) : null
    const threshold = SNAP_PX / pxPerSec
    if (d.mode === 'move') {
      const primary = d.origin.clips[d.clipId]
      d.target = d.ids.length === 1 ? targetAt(e.clientY, trackKindFor(primary.kind)) : null
      const { recipe, snappedAt } = computeMove({ origin: d.origin, ids: d.ids, primaryId: d.clipId, dt, target: d.target, snapPoints: points, snapThreshold: threshold })
      projectActions.transient(recipe)
      setSnapLine(snappedAt)
      setDropHint(d.target?.kind === 'new' ? { trackId: d.target.trackKind === 'audio' ? 'new-audio' : 'new-top', time: 0 } : null)
    } else if (d.mode === 'fade-in' || d.mode === 'fade-out') {
      projectActions.transient(computeFade(d.origin, d.clipId, d.mode === 'fade-in' ? 'in' : 'out', dt))
    } else {
      const { recipe, snappedAt } = computeTrim({ origin: d.origin, id: d.clipId, edge: d.mode === 'trim-start' ? 'start' : 'end', dt, snapPoints: points, snapThreshold: threshold })
      projectActions.transient(recipe)
      setSnapLine(snappedAt)
    }
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    setSnapLine(null)
    setDropHint(null)
    if (!d?.started) return
    if (d.mode === 'move') {
      projectActions.transient((draft) => resolveDrop(draft as Project, d.ids, d.clipId, d.target))
      projectActions.end(t('timeline.move'))
    } else {
      projectActions.end(d.mode.startsWith('fade') ? t('timeline.fade') : t('timeline.trim'))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag.current?.started) {
        drag.current = null
        projectActions.cancelGesture()
        setSnapLine(null)
        setDropHint(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ------------------------------------------------------------ media drop

  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (!types.includes(ASSET_MIME) && !types.includes(FILE_MIME) && !types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropHint({ trackId: '', time: timeAt(e.clientX) })
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropHint(null)
    const time = timeAt(e.clientX)
    const assetId = e.dataTransfer.getData(ASSET_MIME)
    const filePath = e.dataTransfer.getData(FILE_MIME)
    const assets = assetId
      ? [useProject.getState().project!.assets[assetId]].filter(Boolean)
      : await importFiles(filePath ? [await api.media.copyToProject(project.id, filePath)] : [...e.dataTransfer.files].map(pathForFile))
    let at = time
    for (const asset of assets) {
      const kind = asset.kind === 'audio' ? 'audio' : 'video'
      const target = targetAt(e.clientY, kind)
      const targetTrack = target?.kind === 'track' ? useProject.getState().project!.tracks.find((tr) => tr.id === target.trackId) : undefined
      if (targetTrack?.main) {
        const p = useProject.getState().project!
        projectActions.apply(t('timeline.addClip'), (d) => {
          const clip = clipFromAsset(asset, targetTrack.id, at)
          if (p.settings.magnetic) {
            // Insert between clips at the drop position; packing keeps the new order.
            const order = Object.values(d.clips).filter((c) => c.trackId === targetTrack.id).sort((a, b) => a.start - b.start)
            const idx = order.findIndex((c) => at < c.start + c.duration / 2)
            const after = idx < 0 ? [] : order.slice(idx)
            clip.start = after.length ? after[0].start : order.reduce((end, c) => Math.max(end, c.start + c.duration), 0)
            for (const c of after) c.start += clip.duration
          } else if (!isRangeFree(d as Project, targetTrack.id, at, at + clip.duration)) {
            clip.trackId = findOrCreateFreeTrack(d as Project, 'video', at, at + clip.duration).id
          }
          d.clips[clip.id] = clip
          editorActions.select([clip.id])
        })
      } else if (asset.kind === 'audio' || target) {
        projectActions.apply(t('timeline.addClip'), (d) => {
          const clip = clipFromAsset(asset, '', at)
          const preferId = target?.kind === 'track' ? target.trackId : undefined
          clip.trackId = findOrCreateFreeTrack(d as Project, kind, at, at + clip.duration, { preferId }).id
          d.clips[clip.id] = clip
          editorActions.select([clip.id])
        })
      } else {
        addAssetToTimeline(asset)
      }
      at += asset.kind === 'image' ? 3 : asset.duration
    }
  }

  // ------------------------------------------------------------ render

  /** Scrubbing snaps the playhead to clip edges (Alt bypasses snapping). */
  const scrubTo = (e: React.PointerEvent) => {
    const time = timeAt(e.clientX)
    const snapped = snapping !== e.altKey ? nearestSnap(time, snapPoints(project, 0, new Set()), SNAP_PX / pps) : null
    seek(snapped ?? time)
  }
  const scrubRuler = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    getPreview()?.pause()
    scrubTo(e)
  }

  /** Clicking empty lane space selects the gap there (on free tracks) so Delete can close it. */
  const onLaneDown = (e: React.PointerEvent, track: Track) => {
    // React events bubble out of portals (context menus); only real lane clicks count.
    if (e.target !== e.currentTarget) return
    if (e.button !== 0 || e.shiftKey || e.ctrlKey) return
    const time = timeAt(e.clientX)
    const magnetic = track.main && project.settings.magnetic
    const onTrack = Object.values(project.clips).filter((c) => c.trackId === track.id)
    const before = onTrack.filter((c) => c.start + c.duration <= time + 1e-6)
    const after = onTrack.filter((c) => c.start >= time - 1e-6)
    if (!magnetic && !track.locked && after.length) {
      const start = before.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
      const end = Math.min(...after.map((c) => c.start))
      if (end - start > 1e-3) return editorActions.selectGap({ trackId: track.id, start, end })
    }
    editorActions.select([])
  }

  let y = RULER_H
  const rows = tracks.map((track) => {
    const top = y
    y += rowHeight(track)
    return { track, top }
  })

  return (
    <div className={s.timeline}>
      <div
        ref={scroller}
        data-timeline-width
        className={s.scroller}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint(null)}
        onDrop={onDrop}
      >
        <div className={s.inner} style={{ width: HEADER_W + contentW, minHeight: y + 40 }}>
          <div className={s.rulerRow} style={{ height: RULER_H }}>
            <div className={s.corner} style={{ width: HEADER_W }} />
            <div
              className={s.rulerLane}
              onPointerDown={scrubRuler}
              onPointerMove={(e) => e.buttons === 1 && !drag.current && scrubTo(e)}
            >
              <Ruler view={view} pps={pps} fps={project.settings.fps} />
              <MarkerFlags project={project} pps={pps} />
            </div>
          </div>

          {dropHint?.trackId === 'new-top' && <div className={s.newTrackHint} style={{ top: RULER_H, left: HEADER_W }} />}

          {rows.map(({ track }) => (
            <div key={track.id} className={s.row} data-main={track.main} style={{ height: rowHeight(track) }}>
              <TrackHeader track={track} />
              <div
                className={s.lane}
                data-locked={track.locked}
                onPointerDown={(e) => onLaneDown(e, track)}
              >
                {gap?.trackId === track.id && <div className={s.gap} style={{ left: gap.start * pps, width: (gap.end - gap.start) * pps }} />}
                {Object.values(project.clips)
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      project={project}
                      pps={pps}
                      view={view}
                      height={rowHeight(track)}
                      selected={selected.has(clip.id)}
                      onPointerDown={onClipPointerDown}
                    />
                  ))}
                {track.kind === 'video' && <Cuts project={project} trackId={track.id} pps={pps} />}
              </div>
            </div>
          ))}

          {dropHint?.trackId === 'new-audio' && <div className={s.newTrackHint} style={{ top: y, left: HEADER_W }} />}

          {tracks.length === 1 && Object.keys(project.clips).length === 0 && (
            <div className={s.emptyHint} style={{ top: RULER_H + 8, left: HEADER_W + 16 }}>
              {t('timeline.empty')}
            </div>
          )}

          {project.range && (
            <>
              <div className={s.rangeShade} style={{ left: HEADER_W, width: project.range.in * pps, top: RULER_H }} />
              <div className={s.rangeShade} style={{ left: HEADER_W + project.range.out * pps, right: 0, top: RULER_H }} />
            </>
          )}
          {snapLine !== null && <div className={s.snapLine} style={{ left: HEADER_W + snapLine * pps }} />}
          {dropHint && dropHint.trackId === '' && <div className={s.dropLine} style={{ left: HEADER_W + dropHint.time * pps }} />}
          <div className={s.playhead} style={{ left: HEADER_W + playhead * pps }}>
            <div className={s.playheadKnob} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Marker flags (click to jump, drag to move) and the in/out range bar in the ruler. */
function MarkerFlags({ project, pps }: { project: Project; pps: number }) {
  const t = useT()
  const drag = useRef<{ id: string; x0: number; t0: number; moved: boolean } | null>(null)
  const { range, markers } = project
  return (
    <>
      {range && <div className={s.rangeBar} style={{ left: range.in * pps, width: Math.max(1, (range.out - range.in) * pps) }} data-testid="range" />}
      {markers.map((m) => (
        <div
          key={m.id}
          className={s.marker}
          style={{ left: m.t * pps, background: MARKER_COLORS[m.color] }}
          title={m.label}
          data-testid="marker"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            e.stopPropagation()
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { id: m.id, x0: e.clientX, t0: m.t, moved: false }
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const dx = e.clientX - d.x0
            if (!d.moved && Math.abs(dx) < 3) return
            if (!d.moved) {
              d.moved = true
              projectActions.begin()
            }
            const time = snapToFrame(Math.max(0, d.t0 + dx / pps), project.settings.fps)
            projectActions.transient((draft) => {
              const mk = draft.markers.find((x) => x.id === d.id)
              if (mk) mk.t = time
            })
          }}
          onPointerUp={() => {
            const d = drag.current
            drag.current = null
            if (!d) return
            if (d.moved) {
              projectActions.transient((draft) => void draft.markers.sort((a, b) => a.t - b.t))
              projectActions.end(t('timeline.moveMarker'))
            } else seek(m.t)
          }}
        />
      ))}
    </>
  )
}

/** Cut points between adjacent clips: a button to add a transition, or the transition itself. */
function Cuts({ project, trackId, pps }: { project: Project; trackId: string; pps: number }) {
  const t = useT()
  const cut = useEditor((st) => st.cutClipId)
  const clips = Object.values(project.clips)
    .filter((c): c is VideoClip | ImageClip => c.trackId === trackId && (c.kind === 'video' || c.kind === 'image'))
    .sort((a, b) => a.start - b.start)
  return (
    <>
      {clips.slice(1).map((clip, i) => {
        const prev = clips[i]
        if (Math.abs(prev.start + prev.duration - clip.start) > 1e-3) return null
        const d = clip.transition ? Math.min(clip.transition.duration, prev.duration, clip.duration) : 0
        return (
          <button
            key={clip.id}
            type="button"
            className={clip.transition ? s.transition : s.cut}
            data-active={cut === clip.id}
            style={clip.transition ? { left: (clip.start - d / 2) * pps, width: Math.max(14, d * pps) } : { left: clip.start * pps - 8 }}
            title={t('timeline.addTransition')}
            aria-label={t('timeline.addTransition')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => editorActions.focusCut(clip.id)}
          >
            <ArrowRightLeft />
          </button>
        )
      })}
    </>
  )
}

function TrackHeader({ track }: { track: Track }) {
  const t = useT()
  const toggle = (key: 'muted' | 'hidden' | 'locked', label: string) =>
    projectActions.apply(label, (d) => {
      const tr = d.tracks.find((x) => x.id === track.id)
      if (tr) tr[key] = !tr[key]
    })
  const Icon = track.kind === 'audio' ? AudioLines : track.kind === 'text' ? Type : Film
  return (
    <div className={s.header} style={{ width: HEADER_W }}>
      <Icon className={s.headerIcon} />
      <span className={s.headerName}>{track.main ? t('timeline.mainTrack') : t(`timeline.track.${track.kind}`)}</span>
      <div className={s.headerButtons}>
        {track.kind !== 'text' && (
          <button type="button" className={s.headerButton} data-on={track.muted} aria-label={t('timeline.mute')} title={t('timeline.mute')} onClick={() => toggle('muted', t('timeline.mute'))}>
            {track.muted ? <VolumeX /> : <Volume2 />}
          </button>
        )}
        {track.kind !== 'audio' && (
          <button type="button" className={s.headerButton} data-on={track.hidden} aria-label={t('timeline.hide')} title={t('timeline.hide')} onClick={() => toggle('hidden', t('timeline.hide'))}>
            {track.hidden ? <EyeOff /> : <Eye />}
          </button>
        )}
        <button type="button" className={s.headerButton} data-on={track.locked} aria-label={t('timeline.lock')} title={t('timeline.lock')} onClick={() => toggle('locked', t('timeline.lock'))}>
          {track.locked ? <Lock /> : <LockOpen />}
        </button>
      </div>
    </div>
  )
}
