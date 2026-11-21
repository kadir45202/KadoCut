import { Pause, Play, StepBack, StepForward } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AspectPreset, Project } from '@shared/project/schema'
import { ModuleBoundary } from '@renderer/core/modules/ModuleBoundary'
import { activeModules, useModules } from '@renderer/core/modules/registry'
import type { ViewerGeometry } from '@renderer/core/modules/types'
import { projectDuration } from '@renderer/core/project/timeline'
import { shortSide, sizeFor } from '@renderer/core/project/canvas'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { PreviewEngine, getPreview, seek, setPreview, type PreviewQuality } from '@renderer/engine/preview'
import { expandCompounds, ownerId } from '@renderer/engine/expand'
import { evaluateFrame, hitTest } from '@renderer/engine/scene'
import { useT } from '@renderer/i18n'
import { log } from '@renderer/lib/api'
import { timecode } from '@renderer/lib/format'
import { IconButton, Select } from '@renderer/ui/controls'
import { ErrorCard } from '@renderer/ui/layout'
import { GuidesMenu, GuidesOverlay } from './Guides'
import { AudioMeter } from './Meter'
import { Scopes } from './Scopes'
import s from './editor.module.css'

export function Viewer() {
  const t = useT()
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [engineError, setEngineError] = useState<string | null>(null)
  const [engine, setEngine] = useState<PreviewEngine | null>(null)
  const settings = useProject((st) => st.project!.settings)
  const quality = useSettings((st) => st.settings.previewQuality)
  const scopes = useSettings((st) => st.settings.viewer.scopes)

  useEffect(() => {
    if (!canvasRef.current) return
    try {
      const engine = new PreviewEngine(canvasRef.current)
      engine.setQuality(useSettings.getState().settings.previewQuality)
      setPreview(engine)
      setEngine(engine)
      return () => {
        setPreview(null)
        setEngine(null)
        engine.dispose()
      }
    } catch (err) {
      log.error('viewer', 'preview engine failed', err)
      setEngineError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => getPreview()?.setQuality(quality), [quality])

  // Fit the canvas into the stage while keeping the project aspect ratio.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => {
      const pad = 24
      const aw = Math.max(0, el.clientWidth - pad * 2)
      const ah = Math.max(0, el.clientHeight - pad * 2)
      const k = Math.min(aw / settings.width, ah / settings.height)
      setSize({ w: Math.floor(settings.width * k), h: Math.floor(settings.height * k) })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [settings.width, settings.height])

  const geometry: ViewerGeometry = { scale: size.w / settings.width || 0, width: settings.width, height: settings.height }

  /** Clicking the picture selects the topmost clip under the cursor. */
  const onStageClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.canvas) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const px = (e.clientX - rect.left) / geometry.scale
    const py = (e.clientY - rect.top) / geometry.scale
    const project = useProject.getState().project!
    const layers = evaluateFrame(expandCompounds(project), useEditor.getState().playhead)
    // Adjustment layers cover the whole canvas; pick what is visible instead.
    const hit = [...layers].reverse().find((l) => l.clip.kind !== 'adjustment' && hitTest(l, px, py))
    editorActions.select(hit ? [ownerId(hit.clip)] : [], e.shiftKey || e.ctrlKey)
  }

  return (
    <div className={s.viewer}>
      <div className={s.stage} ref={stageRef} onPointerDown={onStageClick as never}>
        {engineError ? (
          <ErrorCard title={t('viewer.engineError')} message={engineError} />
        ) : (
          <div className={s.canvasWrap} style={{ width: size.w, height: size.h }}>
            <canvas ref={canvasRef} data-canvas="1" className={s.canvas} style={{ width: size.w, height: size.h }} />
            <GuidesOverlay width={size.w} height={size.h} />
            <ViewerOverlays geometry={geometry} />
          </div>
        )}
        {scopes && !engineError && <Scopes engine={engine} />}
      </div>
      <Transport quality={quality} />
    </div>
  )
}

function ViewerOverlays({ geometry }: { geometry: ViewerGeometry }) {
  const records = useModules((st) => st.records)
  const selection = useEditor((st) => st.selection)
  const clip = useProject((st) => (selection.length === 1 ? st.project!.clips[selection[0]] : undefined))
  const playhead = useEditor((st) => st.playhead)
  const overlays = useMemo(
    () =>
      activeModules(records)
        .flatMap((m) => (m.viewer ?? []).map((v) => ({ ...v, moduleId: m.id })))
        .sort((a, b) => a.order - b.order),
    [records]
  )
  if (!clip || geometry.scale <= 0) return null
  // Only show handles while the clip is on screen.
  if (playhead < clip.start || playhead >= clip.start + clip.duration) return null
  return (
    <>
      {overlays
        .filter((o) => {
          try {
            return o.when(clip)
          } catch {
            return false
          }
        })
        .map((o) => (
          <ModuleBoundary key={o.id} moduleId={o.moduleId} silent>
            <o.Component clip={clip} geometry={geometry} />
          </ModuleBoundary>
        ))}
    </>
  )
}

function Transport({ quality }: { quality: PreviewQuality }) {
  const t = useT()
  const playhead = useEditor((st) => st.playhead)
  const playing = useEditor((st) => st.playing)
  const project = useProject((st) => st.project!)
  const duration = projectDuration(project)
  const fps = project.settings.fps

  const setAspect = (aspect: AspectPreset) =>
    projectActions.apply(t('viewer.aspect'), (d: Project) => {
      // Keep the chosen size tier (720p … 4K) when the shape changes.
      Object.assign(d.settings, sizeFor(aspect, shortSide(d.settings)))
      d.settings.aspect = aspect
    })

  return (
    <div className={s.transport}>
      <div className={s.transportSide}>
        <span className={`${s.timecode} tabular`}>{timecode(playhead, fps)}</span>
        <span className={`${s.timecodeTotal} tabular`}>/ {timecode(duration, fps)}</span>
        {playing && getPreview()?.speed !== 1 && (
          <span className={s.shuttle} data-testid="shuttle">
            {(getPreview()?.speed ?? 1) < 0 ? '◀ ' : '▶ '}
            {Math.abs(getPreview()?.speed ?? 1)}×
          </span>
        )}
        <AudioMeter />
      </div>
      <div className={s.transportCenter}>
        <IconButton label={t('viewer.prevFrame')} keys="←" onClick={() => seek(playhead - 1 / fps)}>
          <StepBack />
        </IconButton>
        <button type="button" className={s.playButton} aria-label={playing ? t('viewer.pause') : t('viewer.play')} onClick={() => getPreview()?.toggle()}>
          {playing ? <Pause /> : <Play />}
        </button>
        <IconButton label={t('viewer.nextFrame')} keys="→" onClick={() => seek(playhead + 1 / fps)}>
          <StepForward />
        </IconButton>
      </div>
      <div className={`${s.transportSide} ${s.transportRight}`}>
        <GuidesMenu />
        <Select<AspectPreset>
          label={t('viewer.aspect')}
          value={project.settings.aspect}
          width={96}
          onChange={setAspect}
          options={(['9:16', '16:9', '1:1', '4:5'] as const).map((a) => ({ value: a, label: a }))}
        />
        <Select<PreviewQuality>
          label={t('viewer.quality')}
          value={quality}
          width={110}
          onChange={(q) => void settingsActions.update({ previewQuality: q })}
          options={[
            { value: 'full', label: t('viewer.qualityFull') },
            { value: 'half', label: t('viewer.qualityHalf') },
            { value: 'quarter', label: t('viewer.qualityQuarter') }
          ]}
        />
      </div>
    </div>
  )
}
