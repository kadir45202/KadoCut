import { CircleCheck, FolderOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EXPORT_PRESETS, FORMAT_EXTENSIONS, type EncoderInfo, type ExportCodec, type ExportFormat, type ExportPreset, type ExportRequest } from '@shared/export'
import type { Project } from '@shared/project/schema'
import { stretchKey } from '@renderer/core/media/media'
import { projectDuration } from '@renderer/core/project/timeline'
import { JobFailure, cancelJob, runJob, useJobs } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { audioPathFor, needsStretch, soundClips } from '@renderer/engine/audio'
import { expandCompounds } from '@renderer/engine/expand'
import { useFonts } from '@renderer/core/fonts/fonts'
import { getPreview } from '@renderer/engine/preview'
import { useLanguage, useT } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { bytes, duration as fmtDuration, timecode } from '@renderer/lib/format'
import { useEditor } from '@renderer/core/store/editor'
import { Button, Segmented, Select, Switch } from '@renderer/ui/controls'
import { Field, Progress } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'
import s from './export.module.css'

type Phase =
  | { kind: 'setup' }
  | { kind: 'preparing' }
  | { kind: 'rendering'; jobId: string; index: number; total: number }
  | { kind: 'done'; path: string; encoder: string; ms: number; count: number }
  | { kind: 'error'; message: string }

const ENCODER_NAMES: Record<string, string> = {
  nvenc: 'NVIDIA NVENC',
  amf: 'AMD AMF',
  qsv: 'Intel Quick Sync',
  libx264: 'x264',
  libx265: 'x265'
}
const encoderName = (e: string) => ENCODER_NAMES[e.split('_').pop() ?? e] ?? ENCODER_NAMES[e] ?? e
const even = (n: number) => Math.max(16, Math.round(n / 2) * 2)
type AudioExt = 'm4a' | 'mp3' | 'wav'

/** Decodes (cached) audio and stretches the mix needs, returning the path map for export. */
async function prepareAudio(source: Project): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  const project = expandCompounds(source)
  for (const clip of soundClips(project)) {
    const path = audioPathFor(project, clip)
    if (!path) continue
    if (!map[path]) map[path] = (await runJob('media.audio', { path }, 'Audio')).pcmPath
    const rate = needsStretch(clip)
    if (rate) {
      const key = stretchKey(path, rate)
      if (!map[key]) map[key] = (await runJob('audio.stretch', { path, rate }, 'Stretch')).path
    }
  }
  return map
}

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const t = useT()
  const lang = useLanguage((st) => st.lang)
  const project = useProject((st) => st.project!)
  const missing = useProject((st) => st.missing)
  const [encoders, setEncoders] = useState<EncoderInfo | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  const [codec, setCodec] = useState<ExportCodec>('h264')
  const [hardware, setHardware] = useState(true)
  const { width, height, fps } = project.settings

  const presets = useMemo(() => {
    const matching = EXPORT_PRESETS.filter((p) => Math.abs(p.width / p.height - width / height) < 0.01)
    const own = {
      id: 'project',
      width,
      height,
      fps,
      // ~12 Mbps at 1080×1920@30, scaled by pixel rate.
      bitrate: Math.min(150, Math.max(4, Math.round((width * height * fps) / 5_200_000)))
    }
    return matching.some((p) => p.width === width && p.height === height && p.fps === fps) ? matching : [own, ...matching]
  }, [width, height, fps])
  const [presetId, setPresetId] = useState(presets[0].id)
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]
  // Extra formats in other aspect ratios, rendered one after another (batch export).
  const others = useMemo(() => EXPORT_PRESETS.filter((p) => p.fps === 30 && Math.abs(p.width / p.height - width / height) >= 0.01), [width, height])
  const [batch, setBatch] = useState<string[]>([])
  const [fit, setFit] = useState<ExportRequest['fit']>('fill')
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [audioExt, setAudioExt] = useState<AudioExt>('m4a')
  const [gifWidth, setGifWidth] = useState('480')
  const [useRange, setUseRange] = useState(true)
  const playhead = useEditor((st) => st.playhead)
  const range = useRange && project.range && format !== 'png' ? { start: project.range.in, end: project.range.out } : null
  const outDuration = range ? range.end - range.start : projectDuration(project)

  useEffect(() => {
    if (!open) return
    if (phase.kind === 'done' || phase.kind === 'error') setPhase({ kind: 'setup' })
    if (!presets.some((p) => p.id === presetId)) setPresetId(presets[0].id)
    if (!encoders) void api.export.encoders().then(setEncoders)
  }, [open])

  const job = useJobs((st) => (phase.kind === 'rendering' ? st.jobs[phase.jobId] : undefined))
  const hwEncoder = encoders?.[codec][0]
  const hwAvailable = !!hwEncoder && !hwEncoder.startsWith('lib')
  const usedEncoder = encoders ? (hardware && hwAvailable ? encoders[codec][0] : encoders[codec].at(-1)!) : ''
  const usesMissing = Object.values(project.clips).some((c) => 'assetId' in c && missing.includes(c.assetId))
  const empty = projectDuration(project) <= 0

  const start = async () => {
    const ext = format === 'audio' ? audioExt : FORMAT_EXTENSIONS[format][0]
    const outputPath = await api.export.pickOutput(project.name, format, ext)
    if (!outputPath) return
    const started = Date.now()
    setPhase({ kind: 'preparing' })
    getPreview()?.pause()
    try {
      await projectActions.flush()
      const audio = format === 'mp4' || format === 'audio' ? await prepareAudio(useProject.getState().project!) : {}
      const gifW = Number(gifWidth)
      const single = (p: Omit<ExportPreset, 'id'>) => [{ preset: { id: format, ...p }, path: outputPath }]
      const targets =
        format === 'gif'
          ? single({
              width: even(gifW),
              height: even((gifW * height) / width),
              fps: 15,
              bitrate: 1
            })
          : format === 'png'
            ? single({
                width: even(width),
                height: even(height),
                fps,
                bitrate: 1
              })
            : format === 'audio'
              ? single({ width: 16, height: 16, fps, bitrate: 1 })
              : [
                  { preset, path: outputPath },
                  ...others
                    .filter((p) => batch.includes(p.id))
                    .map((p) => ({
                      preset: p,
                      path: outputPath.replace(/(\.mp4)?$/i, `-${p.width}x${p.height}.mp4`)
                    }))
                ]
      // A still is the frame under the playhead.
      const at = Math.min(playhead, Math.max(0, projectDuration(project) - 1 / fps))
      const frame = format === 'png' ? { start: at, end: at + 1 / fps } : null
      let out: { path: string; encoder: string } | null = null
      for (const [index, target] of targets.entries()) {
        const request: ExportRequest = {
          projectId: project.id,
          outputPath: target.path,
          format,
          range: frame ?? range,
          width: target.preset.width,
          height: target.preset.height,
          fps: target.preset.fps,
          bitrate: target.preset.bitrate,
          codec,
          hardware: hardware && hwAvailable,
          audio,
          locale: lang,
          fit,
          fonts: useFonts.getState().custom
        }
        out = await runJob('export.render', request, t('export.jobLabel', { name: project.name }), (jobId) =>
          setPhase({
            kind: 'rendering',
            jobId,
            index,
            total: targets.length
          })
        )
      }
      setPhase({
        kind: 'done',
        path: out!.path,
        encoder: out!.encoder,
        ms: Date.now() - started,
        count: targets.length
      })
    } catch (err) {
      if (err instanceof JobFailure && err.error.code === 'cancelled') setPhase({ kind: 'setup' })
      else
        setPhase({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
    }
  }

  const busy = phase.kind === 'preparing' || phase.kind === 'rendering'
  const setLoudness = (patch: Partial<Project['settings']['loudness']>) => projectActions.apply(t('export.loudness'), (d) => void Object.assign(d.settings.loudness, patch))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && onOpenChange(o)}
      title={t('export.title')}
      footer={
        phase.kind === 'done' ? (
          <>
            <Button icon={<FolderOpen />} onClick={() => void api.app.revealPath(phase.path)}>
              {t('home.reveal')}
            </Button>
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t('common.close')}
            </Button>
          </>
        ) : busy ? (
          <Button onClick={() => phase.kind === 'rendering' && void cancelJob(phase.jobId)} disabled={phase.kind !== 'rendering'}>
            {t('common.cancel')}
          </Button>
        ) : (
          <>
            <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" disabled={!encoders || usesMissing || empty} onClick={start}>
              {t('export.start')}
            </Button>
          </>
        )
      }
    >
      {phase.kind === 'done' ? (
        <div className={s.done}>
          <CircleCheck />
          <div>
            <div className={s.doneTitle}>{t('export.done')}</div>
            <div className={s.dim}>
              {phase.count > 1 ? t('export.batchDone', { count: phase.count }) : phase.path.split(/[\\/]/).pop()}
              {format === 'mp4' ? ` · ${encoderName(phase.encoder)}` : ''} · {fmtDuration(phase.ms / 1000)}
            </div>
          </div>
        </div>
      ) : busy ? (
        <div className={s.progress}>
          <div className={s.progressLabel}>
            <span>{phase.kind === 'preparing' ? t('export.preparing') : job?.message === 'audio' ? t('export.audio') : t('export.rendering')}</span>
            <span className="tabular">
              {phase.kind === 'rendering' && phase.total > 1 ? `${phase.index + 1}/${phase.total} · ` : ''}
              {phase.kind === 'rendering' && job ? `${Math.round(job.progress * 100)}%` : ''}
            </span>
          </div>
          <Progress value={phase.kind === 'rendering' && job && job.progress > 0 ? job.progress : null} />
          <div className={s.dim}>{t('export.keepWorking')}</div>
        </div>
      ) : (
        <div className={s.form}>
          <Field label={t('export.format')}>
            <Segmented<ExportFormat>
              value={format}
              onChange={setFormat}
              options={[
                { value: 'mp4', label: t('export.format.mp4') },
                { value: 'gif', label: 'GIF' },
                { value: 'audio', label: t('export.format.audio') },
                { value: 'png', label: t('export.format.png') }
              ]}
            />
          </Field>
          {project.range && format !== 'png' && (
            <Field label={t('export.range')}>
              <Switch checked={useRange} label={t('export.range')} onChange={setUseRange} />
              <span className={`${s.dim} tabular`}>
                {timecode(project.range.in, fps).slice(3)} – {timecode(project.range.out, fps).slice(3)}
              </span>
            </Field>
          )}
          {format === 'gif' && (
            <Field label={t('export.gifSize')}>
              <Segmented<string>
                value={gifWidth}
                onChange={setGifWidth}
                options={['320', '480', '720'].map((w) => ({
                  value: w,
                  label: `${w}×${even((Number(w) * height) / width)}`
                }))}
              />
            </Field>
          )}
          {format === 'audio' && (
            <Field label={t('export.audioFile')}>
              <Segmented<AudioExt>
                value={audioExt}
                onChange={setAudioExt}
                options={[
                  { value: 'm4a', label: 'M4A (AAC)' },
                  { value: 'mp3', label: 'MP3' },
                  { value: 'wav', label: 'WAV' }
                ]}
              />
            </Field>
          )}
          {format === 'png' && (
            <p className={s.dim}>
              {t('export.stillHint', {
                time: timecode(playhead, fps),
                size: `${even(width)}×${even(height)}`
              })}
            </p>
          )}
          {format === 'mp4' && (
            <>
              <div className={s.presets}>
                {presets.map((p) => (
                  <button key={p.id} type="button" className={s.preset} data-active={p.id === preset.id} onClick={() => setPresetId(p.id)}>
                    <span className={s.presetName}>{p.id === 'project' ? t('export.preset.project') : t(`export.preset.${p.id.split('-')[0] as 'reels' | 'youtube' | 'square' | 'portrait'}`)}</span>
                    <span className={s.dim}>
                      {p.width}×{p.height} · {p.fps} fps · {p.bitrate} Mbps
                    </span>
                  </button>
                ))}
              </div>
              <Field label={t('export.also')}>
                <div className={s.batch}>
                  {others.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={s.batchItem}
                      data-active={batch.includes(p.id)}
                      aria-pressed={batch.includes(p.id)}
                      onClick={() => setBatch((b) => (b.includes(p.id) ? b.filter((x) => x !== p.id) : [...b, p.id]))}
                    >
                      {t(`export.preset.${p.id.split('-')[0] as 'reels' | 'youtube' | 'square' | 'portrait'}`)}
                    </button>
                  ))}
                </div>
              </Field>
              {batch.length > 0 && (
                <Field label={t('export.fit')}>
                  <Segmented<ExportRequest['fit']>
                    value={fit}
                    onChange={setFit}
                    options={[
                      { value: 'fill', label: t('export.fitFill') },
                      { value: 'fit', label: t('export.fitFit') }
                    ]}
                  />
                </Field>
              )}
              <Field label={t('export.codec')}>
                <Segmented<ExportCodec>
                  value={codec}
                  onChange={setCodec}
                  options={[
                    { value: 'h264', label: 'H.264' },
                    { value: 'hevc', label: 'HEVC' }
                  ]}
                />
              </Field>
              <Field label={t('export.gpu')}>
                <Switch checked={hardware && hwAvailable} disabled={!hwAvailable} onChange={setHardware} />
                <span className={s.dim}>{encoders ? (hwAvailable ? encoderName(hwEncoder!) : t('export.noGpu')) : '…'}</span>
              </Field>
              <Field label={t('export.encoder')}>
                <span className={s.dim}>{usedEncoder ? encoderName(usedEncoder) : '…'}</span>
              </Field>
            </>
          )}
          {(format === 'mp4' || format === 'audio') && (
            <Field label={t('export.loudness')}>
              <Switch checked={project.settings.loudness.enabled} label={t('export.loudness')} onChange={(enabled) => setLoudness({ enabled })} />
              {project.settings.loudness.enabled && (
                <Select<string>
                  value={String(project.settings.loudness.target)}
                  onChange={(v) => setLoudness({ target: Number(v) })}
                  options={[
                    { value: '-14', label: t('export.loudness.social') },
                    { value: '-16', label: t('export.loudness.podcast') },
                    { value: '-23', label: t('export.loudness.broadcast') }
                  ]}
                />
              )}
            </Field>
          )}
          {(format === 'mp4' || format === 'audio') && (
            <Field label={t('export.size')}>
              {/* Video bitrate + AAC, or the audio file alone. */}
              <span className={s.dim}>~{bytes((((format === 'mp4' ? preset.bitrate * 1e6 : 0) + (format === 'audio' && audioExt === 'wav' ? 1536e3 : 256e3)) / 8) * outDuration)}</span>
            </Field>
          )}
          {phase.kind === 'error' && <p className={s.error}>{phase.message}</p>}
          {usesMissing && <p className={s.error}>{t('export.missingMedia')}</p>}
          {empty && <p className={s.error}>{t('export.empty')}</p>}
        </div>
      )}
    </Dialog>
  )
}
