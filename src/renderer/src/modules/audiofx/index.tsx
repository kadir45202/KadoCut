import type { Draft } from 'immer'
import { Mic } from 'lucide-react'
import type { AudioClip, AudioProps, Clip, Project, VideoClip, VoiceFx } from '@shared/project/schema'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, ScrubNumber, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import s from './audiofx.module.css'

const strings = defineStrings({
  tr: {
    name: 'Ekolayzır ve kompresör',
    desc: 'Klip sesine 3 bantlı ekolayzır ve kompresör uygular; konuşmayı netleştirir.',
    eq: 'Ekolayzır',
    low: 'Bas',
    mid: 'Orta',
    high: 'Tiz',
    compressor: 'Kompresör',
    threshold: 'Eşik',
    ratio: 'Oran',
    makeup: 'Kazanç',
    enable: 'Açık',
    voice: 'Konuşmayı netleştir',
    edit: 'Ses efekti',
    changer: 'Ses değiştirici',
    'fx.none': 'Yok',
    'fx.telephone': 'Telefon',
    'fx.radio': 'Radyo',
    'fx.megaphone': 'Megafon',
    'fx.echo': 'Yankı',
    'fx.hall': 'Salon',
    'fx.robot': 'Robot',
    'fx.underwater': 'Su altı'
  },
  en: {
    name: 'EQ and compressor',
    desc: 'Applies a 3-band equaliser and a compressor to clip audio; makes speech clearer.',
    eq: 'Equaliser',
    low: 'Low',
    mid: 'Mid',
    high: 'High',
    compressor: 'Compressor',
    threshold: 'Threshold',
    ratio: 'Ratio',
    makeup: 'Make-up gain',
    enable: 'On',
    voice: 'Enhance voice',
    edit: 'Audio effect',
    changer: 'Voice changer',
    'fx.none': 'None',
    'fx.telephone': 'Telephone',
    'fx.radio': 'Radio',
    'fx.megaphone': 'Megaphone',
    'fx.echo': 'Echo',
    'fx.hall': 'Hall',
    'fx.robot': 'Robot',
    'fx.underwater': 'Underwater'
  }
})
const tt = stringsT(strings)
const ID = 'audiofx'
const VOICES: VoiceFx[] = ['none', 'telephone', 'radio', 'megaphone', 'echo', 'hall', 'robot', 'underwater']

type Sound = VideoClip | AudioClip
const isSound = (c: Clip, p: Project): c is Sound =>
  c.kind === 'audio' || (c.kind === 'video' && !c.audio.detached && !!p.assets[c.assetId]?.hasAudio)

function EqSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const { eq, compressor, voice: changer } = (clip as Sound).audio
  const set = (fn: (a: Draft<AudioProps>) => void) => editClip(ID, clip.id, t('edit'), (c) => fn((c as Draft<Sound>).audio))
  const band = (key: 'low' | 'mid' | 'high') => (
    <Field label={t(key)}>
      <ScrubNumber value={eq[key]} min={-24} max={24} step={0.5} precision={1} unit="dB" label={t(key)} {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Sound>).audio.eq[key] = v))} />
    </Field>
  )
  const comp = (key: 'threshold' | 'ratio' | 'makeup', min: number, max: number, unit: string) => (
    <Field label={t(key)}>
      <ScrubNumber value={compressor[key]} min={min} max={max} step={0.5} precision={1} unit={unit} label={t(key)} {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Sound>).audio.compressor[key] = v))} />
    </Field>
  )
  // A gentle broadcast-style voice chain.
  const voice = () =>
    set((a) => {
      a.eq = { enabled: true, low: -4, mid: 2, high: 3 }
      a.compressor = { enabled: true, threshold: -22, ratio: 3, makeup: 5 }
    })
  return (
    <>
      <Section title={t('eq')} defaultOpen={eq.enabled}>
        <Field label={t('enable')}>
          <Switch checked={eq.enabled} label={t('eq')} onChange={(on) => set((a) => void (a.eq.enabled = on))} />
        </Field>
        {eq.enabled && (
          <>
            {band('low')}
            {band('mid')}
            {band('high')}
          </>
        )}
        <Button size="sm" icon={<Mic />} onClick={voice}>
          {t('voice')}
        </Button>
      </Section>
      <Section title={t('changer')} defaultOpen={changer !== 'none'}>
        <div className={s.voices} role="radiogroup" aria-label={t('changer')}>
          {VOICES.map((v) => (
            <button key={v} type="button" role="radio" aria-checked={changer === v} data-active={changer === v} className={s.voice} onClick={() => set((a) => void (a.voice = v))}>
              {t(`fx.${v}`)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('compressor')} defaultOpen={compressor.enabled}>
        <Field label={t('enable')}>
          <Switch checked={compressor.enabled} label={t('compressor')} onChange={(on) => set((a) => void (a.compressor.enabled = on))} />
        </Field>
        {compressor.enabled && (
          <>
            {comp('threshold', -60, 0, 'dB')}
            {comp('ratio', 1, 20, ':1')}
            {comp('makeup', 0, 24, 'dB')}
          </>
        )}
      </Section>
    </>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [{ id: 'audiofx.section', tab: 'audio', order: 25, when: isSound, Component: EqSection }]
})
