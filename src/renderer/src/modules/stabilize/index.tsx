import type { Draft } from 'immer'
import { X } from 'lucide-react'
import type { Clip, VideoClip } from '@shared/project/schema'
import { probeAsset } from '@renderer/core/media/import'
import { clipJobKey, trackClipJob, useClipJob } from '@renderer/core/modules/clipJobs'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { JobFailure, cancelJob, runJob } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, translate, useStrings } from '@renderer/i18n'
import { Button, IconButton, ScrubNumber, Switch } from '@renderer/ui/controls'
import { Field, Progress, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'

const strings = defineStrings({
  tr: {
    name: 'Görüntü sabitleme',
    desc: 'Elde çekilmiş titrek görüntüyü sabitler (FFmpeg vid.stab, tamamen yerel).',
    section: 'Sabitleme',
    enable: 'Titremeyi gider',
    strength: 'Güç',
    apply: 'Yeni güçle yeniden işle',
    job: '{name} sabitleniyor',
    failed: 'Sabitleme yapılamadı',
    hint: 'Görüntü bir kez analiz edilir ve projede saklanır; kenarlar hafifçe yakınlaştırılarak gizlenir.',
    toggle: 'Sabitleme'
  },
  en: {
    name: 'Stabilization',
    desc: 'Smooths out shaky handheld footage (FFmpeg vid.stab, fully local).',
    section: 'Stabilization',
    enable: 'Remove shake',
    strength: 'Strength',
    apply: 'Reprocess with new strength',
    job: 'Stabilizing {name}',
    failed: 'Stabilization failed',
    hint: 'Analysed once and kept in the project; edges are hidden with a slight zoom.',
    toggle: 'Stabilization'
  }
})
const tt = stringsT(strings)
const ID = 'stabilize'

async function process(clip: VideoClip, strength: number) {
  const project = useProject.getState().project!
  const source = project.assets[clip.assetId]
  const key = clipJobKey(ID, clip.id)
  try {
    const out = await runJob(
      'video.stabilize',
      { projectId: project.id, path: source.path, duration: source.duration, strength },
      tt('job', { name: source.name }),
      (id) => trackClipJob(key, id)
    )
    const asset = await probeAsset(out.path, {
      name: `${source.name} (stabilized)`,
      hidden: true,
      derived: { kind: 'stabilized', sourceAssetId: source.id, params: { strength } },
      beats: [],
      transcript: null
    })
    projectActions.apply(
      tt('toggle'),
      (d) => {
        d.assets[asset.id] = asset
        const c = d.clips[clip.id] as Draft<VideoClip> | undefined
        if (c) c.stabilize = { enabled: true, strength, assetId: asset.id }
      },
      ID
    )
  } catch (err) {
    if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
  } finally {
    trackClipJob(key, null)
  }
}

function StabilizeSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const video = clip as VideoClip
  const { stabilize } = video
  const job = useClipJob(clipJobKey(ID, clip.id))
  // A render of the same media at the same strength (this clip's or a sibling's) is reused.
  const rendered = useProject((st) =>
    Object.values(st.project!.assets).find(
      (a) => a.derived?.kind === 'stabilized' && a.derived.sourceAssetId === video.assetId && a.derived.params.strength === stabilize.strength
    )
  )

  const toggle = (on: boolean) => {
    if (!on) return editClip(ID, clip.id, t('toggle'), (c) => void ((c as Draft<VideoClip>).stabilize.enabled = false))
    if (rendered) return editClip(ID, clip.id, t('toggle'), (c) => void ((c as Draft<VideoClip>).stabilize = { enabled: true, strength: stabilize.strength, assetId: rendered.id }))
    void process(video, stabilize.strength)
  }

  // The strength changed since the render the clip plays.
  const stale = stabilize.enabled && !!stabilize.assetId && rendered?.id !== stabilize.assetId
  return (
    <Section title={t('section')} defaultOpen={stabilize.enabled}>
      <Field label={t('enable')}>
        <Switch checked={stabilize.enabled} disabled={!!job} label={t('enable')} onChange={toggle} />
      </Field>
      <Field label={t('strength')}>
        <ScrubNumber
          value={Math.round(stabilize.strength * 100)}
          min={0}
          max={100}
          step={5}
          unit="%"
          label={t('strength')}
          disabled={!!job}
          {...bindClipNumber(ID, clip.id, t('strength'), (c, v) => void ((c as Draft<VideoClip>).stabilize.strength = Math.round(v) / 100))}
        />
      </Field>
      {job ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <Progress value={job.progress > 0 ? job.progress : null} />
          </div>
          <IconButton small label={translate('common.cancel')} onClick={() => void cancelJob(job.id)}>
            <X />
          </IconButton>
        </div>
      ) : stale ? (
        <Button size="sm" onClick={() => (rendered ? toggle(true) : void process(video, stabilize.strength))}>
          {t('apply')}
        </Button>
      ) : (
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{t('hint')}</div>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [{ id: 'stabilize.section', tab: 'video', order: 42, when: (c) => c.kind === 'video', Component: StabilizeSection }]
})
