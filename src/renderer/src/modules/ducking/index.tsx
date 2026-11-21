import type { Draft } from 'immer'
import type { AudioClip, AudioProps, Clip, Project, VideoClip } from '@shared/project/schema'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { ScrubNumber, Slider, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'

const strings = defineStrings({
  tr: {
    name: 'Otomatik ses kısma',
    desc: 'Konuşma başladığında müziği belirlediğin dB kadar otomatik kısar.',
    section: 'Otomatik ses kısma',
    enable: 'Konuşmada kıs',
    amount: 'Kısma miktarı',
    sensitivity: 'Hassasiyet',
    hint: 'Müzik gibi arka plan seslerinde aç. Diğer kliplerde konuşma olduğunda bu klip otomatik kısılır.',
    edit: 'Ses kısma'
  },
  en: {
    name: 'Auto ducking',
    desc: 'Automatically lowers music by your chosen dB when someone speaks.',
    section: 'Auto ducking',
    enable: 'Duck under speech',
    amount: 'Reduction',
    sensitivity: 'Sensitivity',
    hint: 'Turn on for background audio like music. It is lowered automatically whenever other clips contain speech.',
    edit: 'Ducking'
  }
})
const tt = stringsT(strings)
const ID = 'ducking'

type Sound = VideoClip | AudioClip
const isSound = (c: Clip, p: Project): c is Sound =>
  c.kind === 'audio' || (c.kind === 'video' && !c.audio.detached && !!p.assets[c.assetId]?.hasAudio)

function DuckingSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const ducking = (clip as Sound).audio.ducking
  const set = (patch: Partial<AudioProps['ducking']>) => editClip(ID, clip.id, t('edit'), (c) => void Object.assign((c as Draft<Sound>).audio.ducking, patch))
  return (
    <Section title={t('section')} defaultOpen={ducking.enabled || clip.kind === 'audio'}>
      <Field label={t('enable')}>
        <Switch checked={ducking.enabled} label={t('enable')} onChange={(enabled) => set({ enabled })} />
      </Field>
      {ducking.enabled ? (
        <>
          <Field label={t('amount')}>
            <ScrubNumber
              value={ducking.amount}
              min={-40}
              max={0}
              step={0.5}
              precision={1}
              unit="dB"
              {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Sound>).audio.ducking.amount = v))}
            />
          </Field>
          <Field label={t('sensitivity')}>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={ducking.sensitivity}
              label={t('sensitivity')}
              {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Sound>).audio.ducking.sensitivity = v))}
            />
          </Field>
        </>
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
  inspector: [{ id: 'ducking.section', tab: 'audio', order: 20, when: isSound, Component: DuckingSection }]
})
