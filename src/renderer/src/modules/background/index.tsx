import type { Draft } from 'immer'
import { X } from 'lucide-react'
import type { Clip, ImageClip, VideoClip } from '@shared/project/schema'
import { probeAsset } from '@renderer/core/media/import'
import { clipJobKey, trackClipJob, useClipJob } from '@renderer/core/modules/clipJobs'
import { editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { JobFailure, cancelJob, runJobWithComponents } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, translate, useStrings } from '@renderer/i18n'
import { IconButton, Switch } from '@renderer/ui/controls'
import { Field, Progress, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'

const strings = defineStrings({
  tr: {
    name: 'Arka planı sil',
    desc: 'Yeşil perde olmadan kişiyi arka plandan ayırır (Replicate anahtarı varsa bulutta, yoksa yerel GPU/CPU).',
    section: 'Arka planı sil',
    enable: 'Arka planı sil',
    job: '{name} arka planı siliniyor',
    failed: 'Arka plan silinemedi',
    fallback: 'Bulut servisi yanıt vermedi; yerel işleme kullanıldı.',
    viaCloud: 'Replicate ile (bulut)',
    viaLocal: 'Yerel (RVM modeli)',
    hint: 'İşlem bir kez yapılır ve projede saklanır; açıp kapatmak anında olur.',
    toggle: 'Arka plan silme'
  },
  en: {
    name: 'Remove background',
    desc: 'Separates people from the background without a green screen (Replicate in the cloud with a key, otherwise local GPU/CPU).',
    section: 'Remove background',
    enable: 'Remove background',
    job: 'Removing background of {name}',
    failed: 'Background removal failed',
    fallback: 'The cloud service did not respond; local processing was used.',
    viaCloud: 'Replicate (cloud)',
    viaLocal: 'Local (RVM model)',
    hint: 'Processed once and kept in the project; toggling is instant.',
    toggle: 'Background removal'
  }
})
const tt = stringsT(strings)
const ID = 'background'

type Visual = VideoClip | ImageClip

async function process(clip: Visual) {
  const project = useProject.getState().project!
  const source = project.assets[clip.assetId]
  const key = clipJobKey(ID, clip.id)
  try {
    const out = await runJobWithComponents(
      'video.removeBackground',
      { projectId: project.id, path: source.path, duration: source.duration },
      tt('job', { name: source.name }),
      (id) => trackClipJob(key, id)
    )
    const asset = await probeAsset(out.path, {
      name: `${source.name} (nobg)`,
      hidden: true,
      derived: { kind: 'nobg', sourceAssetId: source.id, params: { provider: out.provider } },
      beats: [],
      transcript: null
    })
    projectActions.apply(
      tt('toggle'),
      (d) => {
        d.assets[asset.id] = asset
        const c = d.clips[clip.id] as Draft<Visual> | undefined
        if (c) c.bgRemoval = { enabled: true, assetId: asset.id }
      },
      ID
    )
    if (out.warning) toast.info(tt('fallback'), out.warning)
  } catch (err) {
    if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
  } finally {
    trackClipJob(key, null)
  }
}

function BackgroundSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const visual = clip as Visual
  const job = useClipJob(clipJobKey(ID, clip.id))
  const rendered = useProject((st) => (visual.bgRemoval.assetId ? st.project!.assets[visual.bgRemoval.assetId] : undefined))
  // Another clip of the same media may already have a render we can reuse.
  const reusable = useProject((st) =>
    Object.values(st.project!.assets).find((a) => a.derived?.kind === 'nobg' && a.derived.sourceAssetId === visual.assetId)
  )

  const toggle = (on: boolean) => {
    if (!on) return editClip(ID, clip.id, t('toggle'), (c) => void ((c as Draft<Visual>).bgRemoval.enabled = false))
    const existing = rendered ?? reusable
    if (existing) {
      return editClip(ID, clip.id, t('toggle'), (c) => void ((c as Draft<Visual>).bgRemoval = { enabled: true, assetId: existing.id }))
    }
    void process(visual)
  }

  const provider = (rendered ?? reusable)?.derived?.params.provider
  return (
    <Section title={t('section')}>
      <Field label={t('enable')}>
        <Switch checked={visual.bgRemoval.enabled} disabled={!!job} label={t('enable')} onChange={toggle} />
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
      ) : (
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>
          {visual.bgRemoval.enabled && provider ? (provider === 'replicate' ? t('viaCloud') : t('viaLocal')) : t('hint')}
        </div>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [{ id: 'background.section', tab: 'video', order: 40, when: (c) => c.kind === 'video' || c.kind === 'image', Component: BackgroundSection }]
})
