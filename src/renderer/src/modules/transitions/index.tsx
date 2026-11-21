import type { Draft } from 'immer'
import { ArrowRightLeft, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Clip, ImageClip, Project, TransitionType, VideoClip } from '@shared/project/schema'
import { editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { mainTrack } from '@renderer/core/project/timeline'
import { useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { TRANSITION_TYPES, previousAdjacent } from '@renderer/engine/transitions'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, ScrubNumber, Slider } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { TransitionIcon } from './TransitionIcon'
import s from './transitions.module.css'

const strings = defineStrings({
  tr: {
    name: 'Geçişler',
    desc: 'Klipler arasında geçişler (çapraz geçiş, kaydırma, yakınlaşma, döndürme, flaş, glitch, whip pan…).',
    panel: 'Geçişler',
    duration: 'Süre',
    applyAll: 'Ana parçadaki tüm kesimlere uygula',
    remove: 'Geçişi kaldır',
    pickCut: 'Timeline’da iki klip arasındaki kesim noktasına tıkla veya ikinci klibi seç.',
    target: 'Seçili kesim: {from} → {to}',
    add: 'Geçiş ekle',
    section: 'Geçiş (girişte)',
    type: 'Tür',
    'type.dissolve': 'Çapraz geçiş',
    'type.fadeBlack': 'Siyaha geçiş',
    'type.fadeWhite': 'Beyaza geçiş',
    'type.slideLeft': 'Sola kaydır',
    'type.slideUp': 'Yukarı kaydır',
    'type.push': 'İt',
    'type.zoomIn': 'Yakınlaş',
    'type.zoomOut': 'Uzaklaş',
    'type.whip': 'Whip pan',
    'type.wipe': 'Silme',
    'type.slideRight': 'Sağa kaydır',
    'type.slideDown': 'Aşağı kaydır',
    'type.spin': 'Döndür',
    'type.flash': 'Flaş',
    'type.glitch': 'Glitch',
    'type.iris': 'Daire'
  },
  en: {
    name: 'Transitions',
    desc: 'Transitions between clips (dissolve, slide, zoom, spin, flash, glitch, whip pan…).',
    panel: 'Transitions',
    duration: 'Duration',
    applyAll: 'Apply to every cut on the main track',
    remove: 'Remove transition',
    pickCut: 'Click a cut between two clips on the timeline, or select the second clip.',
    target: 'Selected cut: {from} → {to}',
    add: 'Add transition',
    section: 'Transition (in)',
    type: 'Type',
    'type.dissolve': 'Cross dissolve',
    'type.fadeBlack': 'Fade to black',
    'type.fadeWhite': 'Fade to white',
    'type.slideLeft': 'Slide left',
    'type.slideUp': 'Slide up',
    'type.push': 'Push',
    'type.zoomIn': 'Zoom in',
    'type.zoomOut': 'Zoom out',
    'type.whip': 'Whip pan',
    'type.wipe': 'Wipe',
    'type.slideRight': 'Slide right',
    'type.slideDown': 'Slide down',
    'type.spin': 'Spin',
    'type.flash': 'Flash',
    'type.glitch': 'Glitch',
    'type.iris': 'Iris'
  }
})
const tt = stringsT(strings)
const ID = 'transitions'
const DEFAULT_DURATION = 0.5

type Visual = VideoClip | ImageClip
const isVisual = (c: Clip | undefined): c is Visual => c?.kind === 'video' || c?.kind === 'image'

/** The clip after the focused cut (or the selected clip) — only if something precedes it. */
function useTarget(): { to: Visual; from: Visual } | null {
  const project = useProject((st) => st.project!)
  const cut = useEditor((st) => st.cutClipId)
  const selection = useEditor((st) => st.selection)
  const id = cut ?? (selection.length === 1 ? selection[0] : null)
  const to = id ? project.clips[id] : undefined
  if (!isVisual(to)) return null
  const from = previousAdjacent(project, to)
  return from ? { to, from } : null
}

function setTransition(clipId: string, type: TransitionType, duration: number) {
  editClip(ID, clipId, tt('add'), (c) => {
    ;(c as Draft<Visual>).transition = { type, duration }
  })
}

function TransitionsPanel() {
  const t = useStrings(strings)
  const target = useTarget()
  const [duration, setDuration] = useState(DEFAULT_DURATION)
  const current = target?.to.transition?.type

  const applyAll = (type: TransitionType) =>
    projectActions.apply(
      t('applyAll'),
      (d) => {
        const draft = d as Project
        const main = mainTrack(draft).id
        for (const c of Object.values(draft.clips)) {
          if (c.trackId === main && isVisual(c) && previousAdjacent(draft, c)) (c as Draft<Visual>).transition = { type, duration }
        }
      },
      ID
    )

  return (
    <div className={s.panel}>
      <p className={s.hint}>{target ? t('target', { from: target.from.name, to: target.to.name }) : t('pickCut')}</p>
      <div className={s.grid}>
        {TRANSITION_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={s.card}
            data-active={current === type}
            disabled={!target}
            onClick={() => target && setTransition(target.to.id, type, duration)}
            title={t(`type.${type}`)}
          >
            <TransitionIcon type={type} />
            <span>{t(`type.${type}`)}</span>
          </button>
        ))}
      </div>
      <Field label={`${t('duration')}: ${duration.toFixed(1)}s`}>
        <Slider min={0.1} max={2} step={0.1} value={duration} onChange={setDuration} label={t('duration')} />
      </Field>
      <Button size="sm" disabled={!current} onClick={() => current && applyAll(current)}>
        {t('applyAll')}
      </Button>
    </div>
  )
}

function TransitionSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const transition = (clip as Visual).transition!
  return (
    <Section
      title={`${t('section')}: ${t(`type.${transition.type}`)}`}
      actions={
        <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={t('remove')} onClick={() => editClip(ID, clip.id, t('remove'), (c) => void ((c as Draft<Visual>).transition = null))} />
      }
    >
      <Field label={t('duration')}>
        <ScrubNumber
          value={transition.duration}
          min={0.1}
          max={3}
          step={0.05}
          precision={2}
          unit="s"
          onChange={(v) => editClip(ID, clip.id, t('duration'), (c) => void ((c as Draft<Visual>).transition = { ...transition, duration: v }))}
        />
      </Field>
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'transitions', title: () => tt('panel'), icon: ArrowRightLeft, order: 15, Component: TransitionsPanel }],
  inspector: [{ id: 'transitions.section', tab: 'video', order: 5, when: (c) => isVisual(c) && !!c.transition, Component: TransitionSection }]
})
