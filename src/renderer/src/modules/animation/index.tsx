import type { Draft } from 'immer'
import { Play } from 'lucide-react'
import type { AnimIn, AnimLoop, AnimOut, Clip, ClipAnimation } from '@shared/project/schema'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule, type InspectorDef } from '@renderer/core/modules/types'
import { getPreview, seek } from '@renderer/engine/preview'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { IconButton, ScrubNumber, Select } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'

const strings = defineStrings({
  tr: {
    name: 'Animasyon',
    desc: 'Klip ve yazılara hazır giriş, çıkış ve döngü animasyonları ekler.',
    section: 'Animasyon',
    in: 'Giriş',
    out: 'Çıkış',
    loop: 'Döngü',
    duration: 'Süre',
    period: 'Hız',
    preview: 'Klibi baştan oynat',
    edit: 'Animasyonu değiştir',
    none: 'Yok',
    fade: 'Belirme',
    pop: 'Patlama',
    zoomIn: 'Yakınlaşma',
    zoomOut: 'Uzaklaşma',
    slideUp: 'Yukarı kayma',
    slideDown: 'Aşağı kayma',
    slideLeft: 'Sola kayma',
    slideRight: 'Sağa kayma',
    bounce: 'Zıplama',
    typewriter: 'Daktilo',
    pulse: 'Nabız',
    wiggle: 'Titreme',
    float: 'Süzülme',
    swing: 'Sallanma'
  },
  en: {
    name: 'Animation',
    desc: 'Adds preset in, out and loop animations to clips and text.',
    section: 'Animation',
    in: 'In',
    out: 'Out',
    loop: 'Loop',
    duration: 'Duration',
    period: 'Speed',
    preview: 'Play clip from start',
    edit: 'Change animation',
    none: 'None',
    fade: 'Fade',
    pop: 'Pop',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    slideUp: 'Slide up',
    slideDown: 'Slide down',
    slideLeft: 'Slide left',
    slideRight: 'Slide right',
    bounce: 'Bounce',
    typewriter: 'Typewriter',
    pulse: 'Pulse',
    wiggle: 'Wiggle',
    float: 'Float',
    swing: 'Swing'
  }
})
const tt = stringsT(strings)
const ID = 'animation'

const IN: AnimIn[] = ['none', 'fade', 'pop', 'zoomIn', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'bounce', 'typewriter']
const OUT: AnimOut[] = ['none', 'fade', 'pop', 'zoomOut', 'slideUp', 'slideDown', 'slideLeft', 'slideRight']
const LOOP: AnimLoop[] = ['none', 'pulse', 'wiggle', 'float', 'swing']

type Animated = Extract<Clip, { anim: ClipAnimation }>
const hasAnim = (c: Clip): c is Animated => 'anim' in c

function AnimationSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const anim = (clip as Animated).anim
  const set = (patch: (a: Draft<ClipAnimation>) => void) => editClip(ID, clip.id, t('edit'), (c) => patch((c as Draft<Animated>).anim))
  const seconds = (part: 'in' | 'out') =>
    bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Animated>).anim[part].duration = v))
  // Typewriter only makes sense for text.
  const inTypes = clip.kind === 'text' ? IN : IN.filter((x) => x !== 'typewriter')
  const options = <T extends AnimIn | AnimOut | AnimLoop>(list: T[]) => list.map((value) => ({ value, label: t(value) }))
  const preview = () => {
    seek(clip.start)
    void getPreview()?.play()
  }

  return (
    <Section
      title={t('section')}
      actions={
        <IconButton small label={t('preview')} onClick={preview}>
          <Play />
        </IconButton>
      }
    >
      <Field label={t('in')}>
        <Select<AnimIn> label={t('in')} value={anim.in.type} onChange={(type) => set((a) => void (a.in.type = type))} options={options(inTypes)} />
        {anim.in.type !== 'none' && <ScrubNumber value={anim.in.duration} min={0.05} max={5} step={0.05} precision={2} unit="s" label={t('duration')} {...seconds('in')} />}
      </Field>
      <Field label={t('out')}>
        <Select<AnimOut> label={t('out')} value={anim.out.type} onChange={(type) => set((a) => void (a.out.type = type))} options={options(OUT)} />
        {anim.out.type !== 'none' && <ScrubNumber value={anim.out.duration} min={0.05} max={5} step={0.05} precision={2} unit="s" label={t('duration')} {...seconds('out')} />}
      </Field>
      <Field label={t('loop')}>
        <Select<AnimLoop> label={t('loop')} value={anim.loop.type} onChange={(type) => set((a) => void (a.loop.type = type))} options={options(LOOP)} />
        {anim.loop.type !== 'none' && (
          <ScrubNumber
            value={anim.loop.period}
            min={0.2}
            max={10}
            step={0.1}
            precision={1}
            unit="s"
            label={t('period')}
            {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Animated>).anim.loop.period = v))}
          />
        )}
      </Field>
    </Section>
  )
}

const section = (tab: InspectorDef['tab'], when: (c: Clip) => boolean): InspectorDef => ({ id: `animation.${tab}`, tab, order: 12, when: (c) => hasAnim(c) && when(c), Component: AnimationSection })

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [section('video', (c) => c.kind !== 'text'), section('text', (c) => c.kind === 'text')]
})
