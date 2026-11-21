import { Clapperboard, Play, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { JobOutput } from '@shared/jobs'
import type { Project, VideoClip } from '@shared/project/schema'
import { clipFromAsset } from '@renderer/core/project/factory'
import { JobFailure, runJob } from '@renderer/core/store/jobs'
import { useProject } from '@renderer/core/store/project'
import { seek } from '@renderer/engine/preview'
import { useStrings } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { shortDuration } from '@renderer/lib/format'
import { Button, IconButton } from '@renderer/ui/controls'
import { Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { toTimeline } from '../silence/detect'
import { speechClips } from './words'
import { strings } from './strings'
import s from './transcript.module.css'

type Highlight = JobOutput<'ai.highlights'>['clips'][number]

/** New vertical project that contains just this part of the source video. */
async function createShort(project: Project, assetId: string, h: Highlight) {
  const asset = project.assets[assetId]
  const opened = await api.projects.create({ name: h.title.slice(0, 80) || asset.name, aspect: '9:16', fps: project.settings.fps })
  const next = opened.project
  next.assets[asset.id] = { ...asset }
  const clip = clipFromAsset(asset, 'main', 0) as VideoClip
  clip.in = h.start
  clip.duration = h.end - h.start
  next.clips[clip.id] = clip
  await api.projects.save(next)
}

/** Picks the best short clips of the main video from its transcript (Claude or local scoring). */
export function Highlights() {
  const t = useStrings(strings)
  const project = useProject((st) => st.project!)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ assetId: string; clips: Highlight[] } | null>(null)
  const source = speechClips(project).find((c) => project.assets[c.assetId]?.transcript)

  const find = async () => {
    if (!source) return
    const asset = project.assets[source.assetId]
    setBusy(true)
    try {
      const out = await runJob(
        'ai.highlights',
        { words: asset.transcript!.words, count: 5, minLength: 15, maxLength: 60, language: asset.transcript!.language },
        t('highlightsJob', { name: asset.name })
      )
      setResult({ assetId: asset.id, clips: out.clips })
      if (!out.clips.length) toast.info(t('highlightsNone'))
      else if (out.provider === 'local') toast.info(t('highlightsLocal'), out.warning)
    } catch (err) {
      if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(t('highlightsFailed'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Timeline position of a source range, when a main clip still shows it.
  const where = (h: Highlight) => {
    const clip = speechClips(project).find((c) => c.assetId === result?.assetId && c.in <= h.start + 1e-3)
    return clip ? toTimeline(clip, [[h.start, h.end]])[0][0] : null
  }

  return (
    <Section title={t('highlights')} defaultOpen={false}>
      <Button size="sm" icon={<Sparkles />} disabled={busy || !source} onClick={find}>
        {busy ? t('highlightsWorking') : t('highlightsFind')}
      </Button>
      <p className={s.hint}>{source ? t('highlightsHint') : t('notYet')}</p>
      {result?.clips.map((h, i) => {
        const at = where(h)
        return (
          <div key={i} className={s.highlight}>
            <div className={s.highlightTitle}>{h.title}</div>
            <div className={s.count}>
              {shortDuration(h.start)} – {shortDuration(h.end)} · {Math.round(h.end - h.start)} s
            </div>
            {h.reason && <div className={s.hint}>{h.reason}</div>}
            <div className={s.toolbar}>
              <IconButton small label={t('highlightsPreview')} disabled={at === null} onClick={() => at !== null && seek(at)}>
                <Play />
              </IconButton>
              <Button
                size="sm"
                icon={<Clapperboard />}
                onClick={() =>
                  void createShort(useProject.getState().project!, result.assetId, h)
                    .then(() => toast.success(t('highlightsCreated', { name: h.title })))
                    .catch((err) => toast.error(t('highlightsFailed'), err instanceof Error ? err.message : String(err)))
                }
              >
                {t('highlightsCreate')}
              </Button>
            </div>
          </div>
        )
      })}
    </Section>
  )
}
