import { AudioWaveform, Eraser, Gauge, Snowflake, Spline, VolumeX } from 'lucide-react'
import { memo, useEffect, useMemo, useRef } from 'react'
import type { Clip, Project } from '@shared/project/schema'
import { isMediaClip, sourceTimeAt, type MediaClip } from '@renderer/core/project/clip'
import { localTimeForSourceOffset, sourceSpan } from '@renderer/core/project/speed'
import { useMedia } from '@renderer/core/media/media'
import { ContextMenu, type MenuEntry } from '@renderer/ui/overlays'
import { activeModules, commandEnabled, findCommand, runCommand, useModules } from '@renderer/core/modules/registry'
import { useEditor } from '@renderer/core/store/editor'
import { useProject } from '@renderer/core/store/project'
import { shortDuration } from '@renderer/lib/format'
import { audioPathFor } from '@renderer/engine/audio'
import { mediaUrl } from '@renderer/lib/api'
import s from './timeline.module.css'

interface Props {
  clip: Clip
  project: Project
  pps: number
  view: { left: number; width: number }
  height: number
  selected: boolean
  onPointerDown(e: React.PointerEvent, clip: Clip, mode: 'move' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out'): void
}

const TONE: Record<Clip['kind'], string> = {
  video: 'var(--clip-video)',
  image: 'var(--clip-image)',
  audio: 'var(--clip-audio)',
  text: 'var(--clip-text)',
  shape: 'var(--clip-shape)',
  adjustment: 'var(--clip-adjust)',
  compound: 'var(--clip-compound)'
}

export const ClipView = memo(function ClipView({ clip, project, pps, view, height, selected, onPointerDown }: Props) {
  const left = clip.start * pps
  const width = Math.max(2, clip.duration * pps)
  // Part of the clip that is on screen (clip-local pixels), for virtualized drawing.
  const visFrom = Math.max(0, view.left - left - 50)
  const visTo = Math.min(width, view.left + view.width - left + 50)
  const visible = visTo > visFrom
  const asset = 'assetId' in clip ? project.assets[clip.assetId] : undefined
  const missing = useProject((st) => (asset ? st.missing.includes(asset.id) : false))
  const menu = useClipMenu(clip)
  // Fade handles only on the selected clip, and only where it actually makes sound.
  const audible = selected && isMediaClip(clip) && (clip.kind === 'audio' || (!clip.audio.detached && !!asset?.hasAudio))

  const badges: React.ReactNode[] = []
  if (isMediaClip(clip)) {
    if (clip.speed.mode === 'curve') badges.push(<Spline key="curve" />)
    else if (clip.speed.rate !== 1) badges.push(<span key="rate" className={s.badgeText}><Gauge />{clip.speed.rate.toFixed(clip.speed.rate % 1 ? 1 : 0)}x</span>)
    if (clip.audio.muted && !(clip.kind === 'video' && clip.audio.detached)) badges.push(<VolumeX key="mute" />)
    if (clip.audio.denoise.enabled) badges.push(<AudioWaveform key="dn" />)
  }
  if ((clip.kind === 'video' || clip.kind === 'image') && clip.bgRemoval.enabled) badges.push(<Eraser key="bg" />)
  if (asset?.derived?.kind === 'freeze') badges.push(<Snowflake key="fz" />)

  // Music beats (clip-local seconds) inside the visible part.
  const beats = useMemo(() => {
    if (!isMediaClip(clip) || !asset?.beats.length) return []
    const span = sourceSpan(clip.speed, clip.duration)
    return asset.beats.filter((b) => b >= clip.in && b <= clip.in + span).map((b) => localTimeForSourceOffset(clip.speed, clip.duration, b - clip.in))
  }, [clip, asset])

  const keyTimes = useMemo(() => {
    if (!selected || !('transform' in clip)) return []
    const set = new Set<number>()
    for (const prop of Object.values(clip.transform)) for (const k of prop.keys) set.add(Math.round(k.t * 1000) / 1000)
    return [...set]
  }, [clip, selected])

  return (
    <ContextMenu items={menu}>
      <div
        className={s.clip}
        data-selected={selected}
        data-kind={clip.kind}
        data-caption={clip.kind === 'text' && clip.role === 'caption'}
        style={{ left, width, height: height - 4, background: missing ? 'var(--clip-missing)' : TONE[clip.kind] }}
        onPointerDown={(e) => onPointerDown(e, clip, 'move')}
      >
        {visible && clip.kind === 'video' && asset && height > 40 && <Filmstrip clip={clip} path={asset.path} pps={pps} from={visFrom} to={visTo} height={height - 4} />}
        {visible && clip.kind === 'image' && asset && <div className={s.imageTiles} style={{ backgroundImage: `url("${mediaUrl(asset.path)}")` }} />}
        {visible && isMediaClip(clip) && <Waveform clip={clip} project={project} pps={pps} from={visFrom} to={visTo} height={clip.kind === 'audio' ? height - 22 : 14} />}
        <div className={s.clipLabel}>
          {badges.length > 0 && <span className={s.badges}>{badges}</span>}
          <span className={s.clipName}>{clip.kind === 'text' ? clip.text || clip.name : clip.name}</span>
          {width > 90 && <span className={s.clipDuration}>{shortDuration(clip.duration)}</span>}
        </div>
        {isMediaClip(clip) && clip.audio.fadeIn > 0 && <div className={s.fadeIn} style={{ width: clip.audio.fadeIn * pps }} />}
        {isMediaClip(clip) && clip.audio.fadeOut > 0 && <div className={s.fadeOut} style={{ width: clip.audio.fadeOut * pps }} />}
        {visible &&
          beats.map((b) => (b * pps >= visFrom && b * pps <= visTo ? <span key={b} className={s.beat} style={{ left: b * pps }} /> : null))}
        {keyTimes.map((kt) => (
          <span key={kt} className={s.keyframe} style={{ left: kt * pps }} />
        ))}
        {audible && isMediaClip(clip) && (
          <>
            <span
              className={s.fadeHandle}
              style={{ left: Math.min(width - 8, clip.audio.fadeIn * pps) }}
              title={`Fade in ${clip.audio.fadeIn.toFixed(2)}s`}
              onPointerDown={(e) => onPointerDown(e, clip, 'fade-in')}
            />
            <span
              className={s.fadeHandle}
              style={{ left: Math.max(0, width - clip.audio.fadeOut * pps - 8) }}
              title={`Fade out ${clip.audio.fadeOut.toFixed(2)}s`}
              onPointerDown={(e) => onPointerDown(e, clip, 'fade-out')}
            />
          </>
        )}
        <div className={`${s.handle} ${s.handleLeft}`} onPointerDown={(e) => onPointerDown(e, clip, 'trim-start')} />
        <div className={`${s.handle} ${s.handleRight}`} onPointerDown={(e) => onPointerDown(e, clip, 'trim-end')} />
      </div>
    </ContextMenu>
  )
})

/** Context menu built from module clip-menu contributions. */
function useClipMenu(clip: Clip): MenuEntry[] {
  const records = useModules((st) => st.records)
  // Recompute when selection changes so enabled states are right.
  const selection = useEditor((st) => st.selection)
  return useMemo(() => {
    const items: (MenuEntry & { order: number })[] = []
    for (const m of activeModules(records)) {
      for (const item of m.clipMenu ?? []) {
        const cmd = m.commands?.find((c) => c.id === item.command)
        if (!cmd) continue
        items.push({
          id: cmd.id,
          label: cmd.title(),
          icon: item.icon ? <item.icon /> : undefined,
          shortcut: findCommand(cmd.id)?.keyLabel,
          disabled: !commandEnabled(cmd),
          separatorBefore: item.separatorBefore,
          order: item.order,
          onSelect: () => void runCommand(cmd.id)
        })
      }
    }
    return items.sort((a, b) => a.order - b.order)
  }, [records, clip, selection])
}

function Filmstrip({ clip, path, pps, from, to, height }: { clip: MediaClip; path: string; pps: number; from: number; to: number; height: number }) {
  const strip = useMedia((st) => st.filmstrip[path]?.data)
  if (!strip) return null
  const tileW = (strip.tileWidth / strip.tileHeight) * height
  const first = Math.floor(from / tileW)
  const last = Math.ceil(to / tileW)
  const tiles: React.ReactNode[] = []
  for (let i = first; i < last; i++) {
    const t = clip.start + (i * tileW) / pps
    const src = sourceTimeAt(clip, t)
    const index = Math.min(strip.count - 1, Math.max(0, Math.floor(src / strip.interval)))
    tiles.push(
      <div
        key={i}
        className={s.tile}
        style={{
          left: i * tileW,
          width: tileW,
          height,
          backgroundImage: `url("${strip.url}")`,
          backgroundSize: `${strip.count * tileW}px ${height}px`,
          backgroundPosition: `${-index * tileW}px 0`
        }}
      />
    )
  }
  return <div className={s.filmstrip}>{tiles}</div>
}

function Waveform({ clip, project, pps, from, to, height }: { clip: MediaClip; project: Project; pps: number; from: number; to: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const path = audioPathFor(project, clip)
  const info = useMedia((st) => (path ? st.audio[path] : undefined))
  const peaks = info?.peaks
  const pps2 = info?.data?.peaksPerSecond ?? 100
  const visible = !(clip.kind === 'video' && (clip.audio.detached || !project.assets[clip.assetId]?.hasAudio))

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !peaks) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(to - from))
    canvas.width = w * dpr
    canvas.height = height * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, w, height)
    ctx.fillStyle = clip.audio.muted ? 'rgba(255,255,255,0.18)' : 'rgba(190,240,215,0.55)'
    const gain = Math.min(2, clip.audio.volume.keys.length ? 1 : clip.audio.volume.value)
    for (let x = 0; x < w; x++) {
      const t0 = clip.start + (from + x) / pps
      const s0 = sourceTimeAt(clip, t0) * pps2
      const s1 = sourceTimeAt(clip, t0 + 1 / pps) * pps2
      let peak = 0
      for (let i = Math.floor(s0); i <= Math.ceil(s1) && i < peaks.length; i++) if (i >= 0) peak = Math.max(peak, peaks[i])
      // dB scale (-54..0 dB) so quiet speech is still readable, like other editors.
      const level = peak * gain > 0.002 ? Math.min(1, 1 + (20 * Math.log10(peak * gain)) / 54) : 0
      const bar = level * height
      ctx.fillRect(x, (height - bar) / 2, 1, Math.max(0.5, bar))
    }
  }, [peaks, pps2, clip, pps, from, to, height])

  if (!visible || !peaks) return null
  return <canvas ref={ref} className={s.waveform} style={{ left: from, height }} data-kind={clip.kind} />
}
