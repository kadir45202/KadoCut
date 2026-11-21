import type { Draft } from 'immer'
import { X } from 'lucide-react'
import { useState } from 'react'
import type { AudioClip, Clip, Project, VideoClip } from '@shared/project/schema'
import { probeAsset } from '@renderer/core/media/import'
import { analyzeAsset } from '@renderer/core/media/media'
import { clipJobKey, trackClipJob, useClipJob } from '@renderer/core/modules/clipJobs'
import { editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { JobFailure, cancelJob, runJob } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useSettings } from '@renderer/core/store/settings'
import { defineStrings, stringsT, translate, useStrings } from '@renderer/i18n'
import { IconButton, Slider, Switch } from '@renderer/ui/controls'
import { Field, Progress, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'

const strings = defineStrings({
  tr: {
    name: 'Gürültü azaltma',
    desc: 'Klima, rüzgar, cızırtı gibi arka plan gürültüsünü temizler (ElevenLabs anahtarı varsa bulutta, yoksa yerel).',
    section: 'Gürültü azaltma',
    enable: 'Gürültüyü azalt',
    strength: 'Güç',
    job: '{name} gürültüsü temizleniyor',
    failed: 'Gürültü azaltılamadı',
    fallback: 'Bulut servisi yanıt vermedi; yerel işleme kullanıldı.',
    viaCloud: 'ElevenLabs ile (bulut)',
    viaLocal: 'Yerel (spektral filtre)',
    toggle: 'Gürültü azaltma'
  },
  en: {
    name: 'Noise reduction',
    desc: 'Removes background noise like AC hum, wind or hiss (ElevenLabs in the cloud with a key, otherwise local).',
    section: 'Noise reduction',
    enable: 'Reduce noise',
    strength: 'Strength',
    job: 'Cleaning noise in {name}',
    failed: 'Noise reduction failed',
    fallback: 'The cloud service did not respond; local processing was used.',
    viaCloud: 'ElevenLabs (cloud)',
    viaLocal: 'Local (spectral filter)',
    toggle: 'Noise reduction'
  }
})
const tt = stringsT(strings)
const ID = 'noise'

type Sound = VideoClip | AudioClip
const isSound = (c: Clip, p: Project): c is Sound =>
  c.kind === 'audio' || (c.kind === 'video' && !c.audio.detached && !!p.assets[c.assetId]?.hasAudio)

async function process(clip: Sound, strength: number) {
  const project = useProject.getState().project!
  const source = project.assets[clip.assetId]
  const key = clipJobKey(ID, clip.id)
  try {
    const out = await runJob('audio.denoise', { projectId: project.id, path: source.path, strength }, tt('job', { name: source.name }), (id) => trackClipJob(key, id))
    const asset = await probeAsset(out.path, {
      name: `${source.name} (denoise)`,
      hidden: true,
      derived: { kind: 'denoise', sourceAssetId: source.id, params: { strength, provider: out.provider } },
      beats: [],
      transcript: null
    })
    const ok = projectActions.apply(
      tt('toggle'),
      (d) => {
        d.assets[asset.id] = asset
        const c = d.clips[clip.id] as Draft<Sound> | undefined
        if (c) c.audio.denoise = { enabled: true, strength, assetId: asset.id }
      },
      ID
    )
    if (ok) analyzeAsset(asset)
    if (out.warning) toast.info(tt('fallback'), out.warning)
  } catch (err) {
    if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
  } finally {
    trackClipJob(key, null)
  }
}

function NoiseSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const sound = clip as Sound
  const denoise = sound.audio.denoise
  const job = useClipJob(clipJobKey(ID, clip.id))
  const cloud = useSettings((st) => st.secrets.elevenlabs)
  const rendered = useProject((st) => (denoise.assetId ? st.project!.assets[denoise.assetId] : undefined))
  const [strength, setStrength] = useState(denoise.strength)
  const provider = rendered?.derived?.params.provider

  const toggle = (on: boolean) => {
    if (!on) return editClip(ID, clip.id, t('toggle'), (c) => void ((c as Draft<Sound>).audio.denoise.enabled = false))
    // Reuse the existing render when the settings did not change.
    if (rendered && rendered.derived?.params.strength === strength) {
      return editClip(ID, clip.id, t('toggle'), (c) => void ((c as Draft<Sound>).audio.denoise.enabled = true))
    }
    void process(sound, strength)
  }

  return (
    <Section title={t('section')}>
      <Field label={t('enable')}>
        <Switch checked={denoise.enabled} disabled={!!job} label={t('enable')} onChange={toggle} />
      </Field>
      {!cloud && (
        <Field label={t('strength')}>
          <Slider
            min={0}
            max={1}
            step={0.05}
            value={strength}
            disabled={!!job}
            label={t('strength')}
            onChange={setStrength}
            onEnd={() => denoise.enabled && strength !== denoise.strength && void process(sound, strength)}
          />
        </Field>
      )}
      {job && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <Progress value={job.progress > 0 ? job.progress : null} />
          </div>
          <IconButton small label={translate('common.cancel')} onClick={() => void cancelJob(job.id)}>
            <X />
          </IconButton>
        </div>
      )}
      {!job && denoise.enabled && provider && (
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{provider === 'elevenlabs' ? t('viaCloud') : t('viaLocal')}</div>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [{ id: 'noise.section', tab: 'audio', order: 30, when: isSound, Component: NoiseSection }]
})
