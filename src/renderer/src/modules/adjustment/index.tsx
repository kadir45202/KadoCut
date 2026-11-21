import { useEffect, useState } from 'react'
import type { Draft } from 'immer'
import { Blend, Grid3x3, Layers, Droplet } from 'lucide-react'
import type { AdjustEffect, AdjustmentClip, Clip, EffectType, Project } from '@shared/project/schema'
import { defaultMask } from '@shared/project/defaults'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { adjustmentClip } from '@renderer/core/project/factory'
import { addTrack, findOrCreateFreeTrack, isRangeFree } from '@renderer/core/project/timeline'
import { effectNeedsAmount } from '@renderer/engine/scene'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, ScrubNumber, Select } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { effectThumbs } from './thumbs'
import s from './effects.module.css'

const strings = defineStrings({
  tr: {
    name: 'Efektler',
    desc: 'Altındaki her şeye efekt, renk, bulanıklık veya pikselleştirme uygulayan efekt katmanları ekler.',
    panel: 'Efektler',
    adjustment: 'Ayarlama katmanı',
    adjustmentHint: 'Altındaki tüm kliplere aynı renk ayarını / LUT’u uygular.',
    blur: 'Bulanıklaştırma alanı',
    pixelate: 'Pikselleştirme alanı',
    areaHint: 'Yüz, plaka gibi alanları gizlemek için. Maske ile alanı ayarla.',
    areas: 'Ayarlama ve gizleme',
    applyHint: 'Seçili klip varsa efekt onun süresince, yoksa oynatma çizgisinden itibaren eklenir.',
    add: 'Efekt ekle',
    section: 'Efekt',
    type: 'Tür',
    amount: 'Şiddet',
    gap: 'Ara çizgi',
    edit: 'Efekti değiştir',
    'group.basic': 'Temel',
    'group.retro': 'Retro',
    'group.motion': 'Hareket',
    'group.distort': 'Bozulma',
    'group.split': 'Bölünmüş ekran',
    'fx.none': 'Yok (yalnız renk)',
    'fx.blur': 'Bulanık',
    'fx.pixelate': 'Piksel',
    'fx.vignette': 'Vinyet',
    'fx.sharpen': 'Keskinleştir',
    'fx.glow': 'Parıltı',
    'fx.letterbox': 'Sinema şeridi',
    'fx.grain': 'Film greni',
    'fx.vhs': 'VHS',
    'fx.oldFilm': 'Eski film',
    'fx.sepia': 'Sepya',
    'fx.noir': 'Siyah-beyaz',
    'fx.lightLeak': 'Işık sızıntısı',
    'fx.posterize': 'Poster',
    'fx.shake': 'Kamera sarsıntısı',
    'fx.zoomPulse': 'Ritim zoom',
    'fx.zoomBlur': 'Zoom bulanıklığı',
    'fx.strobe': 'Flaş',
    'fx.glitch': 'Glitch',
    'fx.rgbSplit': 'RGB kayması',
    'fx.fisheye': 'Balıkgözü',
    'fx.invert': 'Negatif',
    'fx.mirror': 'Ayna',
    'fx.kaleido': 'Kaleydoskop',
    'fx.split2': '2’li ekran',
    'fx.split3': '3’lü ekran',
    'fx.split4': '4’lü ekran',
    'fx.split9': '9’lu ekran'
  },
  en: {
    name: 'Effects',
    desc: 'Adds effect layers that apply effects, colour, blur or pixelation to everything below them.',
    panel: 'Effects',
    adjustment: 'Adjustment layer',
    adjustmentHint: 'Applies the same colour grade / LUT to every clip below it.',
    blur: 'Blur area',
    pixelate: 'Pixelate area',
    areaHint: 'Hides faces, number plates and the like. Use the mask to set the area.',
    areas: 'Adjust and hide',
    applyHint: 'With a clip selected the effect covers that clip, otherwise it starts at the playhead.',
    add: 'Add effect',
    section: 'Effect',
    type: 'Type',
    amount: 'Strength',
    gap: 'Divider',
    edit: 'Change effect',
    'group.basic': 'Basic',
    'group.retro': 'Retro',
    'group.motion': 'Motion',
    'group.distort': 'Distort',
    'group.split': 'Split screen',
    'fx.none': 'None (colour only)',
    'fx.blur': 'Blur',
    'fx.pixelate': 'Pixelate',
    'fx.vignette': 'Vignette',
    'fx.sharpen': 'Sharpen',
    'fx.glow': 'Glow',
    'fx.letterbox': 'Cinema bars',
    'fx.grain': 'Film grain',
    'fx.vhs': 'VHS',
    'fx.oldFilm': 'Old film',
    'fx.sepia': 'Sepia',
    'fx.noir': 'Black & white',
    'fx.lightLeak': 'Light leak',
    'fx.posterize': 'Posterize',
    'fx.shake': 'Camera shake',
    'fx.zoomPulse': 'Beat zoom',
    'fx.zoomBlur': 'Zoom blur',
    'fx.strobe': 'Flash',
    'fx.glitch': 'Glitch',
    'fx.rgbSplit': 'RGB split',
    'fx.fisheye': 'Fisheye',
    'fx.invert': 'Negative',
    'fx.mirror': 'Mirror',
    'fx.kaleido': 'Kaleidoscope',
    'fx.split2': '2 screens',
    'fx.split3': '3 screens',
    'fx.split4': '4 screens',
    'fx.split9': '9 screens'
  }
})
const tt = stringsT(strings)
const ID = 'adjustment'

type Group = 'basic' | 'retro' | 'motion' | 'distort' | 'split'

/** Effect library: default strength per effect, shown in panel groups. */
export const EFFECTS: { type: Exclude<EffectType, 'none'>; group: Group; amount: number }[] = [
  { type: 'blur', group: 'basic', amount: 0.4 },
  { type: 'vignette', group: 'basic', amount: 0.7 },
  { type: 'sharpen', group: 'basic', amount: 0.5 },
  { type: 'glow', group: 'basic', amount: 0.6 },
  { type: 'letterbox', group: 'basic', amount: 0.5 },
  { type: 'pixelate', group: 'basic', amount: 0.3 },
  { type: 'grain', group: 'retro', amount: 0.5 },
  { type: 'vhs', group: 'retro', amount: 0.7 },
  { type: 'oldFilm', group: 'retro', amount: 0.8 },
  { type: 'sepia', group: 'retro', amount: 0.8 },
  { type: 'noir', group: 'retro', amount: 1 },
  { type: 'lightLeak', group: 'retro', amount: 0.7 },
  { type: 'posterize', group: 'retro', amount: 0.5 },
  { type: 'shake', group: 'motion', amount: 0.6 },
  { type: 'zoomPulse', group: 'motion', amount: 0.6 },
  { type: 'zoomBlur', group: 'motion', amount: 0.5 },
  { type: 'strobe', group: 'motion', amount: 0.7 },
  { type: 'glitch', group: 'distort', amount: 0.6 },
  { type: 'rgbSplit', group: 'distort', amount: 0.5 },
  { type: 'fisheye', group: 'distort', amount: 0.5 },
  { type: 'invert', group: 'distort', amount: 1 },
  { type: 'mirror', group: 'split', amount: 0 },
  { type: 'kaleido', group: 'split', amount: 0 },
  { type: 'split2', group: 'split', amount: 0.3 },
  { type: 'split3', group: 'split', amount: 0.3 },
  { type: 'split4', group: 'split', amount: 0.3 },
  { type: 'split9', group: 'split', amount: 0.3 }
]
const GROUPS: Group[] = ['basic', 'retro', 'motion', 'distort', 'split']

/** Area effects (blur / pixelate a region) and plain adjustment layers, at the playhead. */
export function addAdjustment(effect: AdjustEffect['type'], name: string) {
  const at = useEditor.getState().playhead
  let id = ''
  projectActions.apply(
    tt('add'),
    (d) => {
      const clip = adjustmentClip('', at)
      clip.name = name
      clip.effect = { type: effect, amount: effect === 'pixelate' ? 0.4 : 0.6 }
      // Area effects start as a soft ellipse in the middle.
      if (effect !== 'none') clip.mask = { ...defaultMask(), type: 'circle', width: 0.3, height: 0.3, feather: 0.2 }
      clip.trackId = findOrCreateFreeTrack(d as Project, 'video', clip.start, clip.start + clip.duration).id
      d.clips[clip.id] = clip
      id = clip.id
    },
    ID
  )
  if (id) editorActions.select([id])
}

/** Full-frame effect layer over the selected clip's time range (or 3 s from the playhead), on top. */
export function addEffect(type: Exclude<EffectType, 'none'>) {
  const def = EFFECTS.find((e) => e.type === type)!
  const { playhead, selection } = useEditor.getState()
  const target = selection.length === 1 ? useProject.getState().project?.clips[selection[0]] : undefined
  const range = target && target.kind !== 'audio' && target.kind !== 'adjustment' ? { start: target.start, duration: target.duration } : { start: playhead, duration: 3 }
  let id = ''
  projectActions.apply(
    tt('add'),
    (d) => {
      const p = d as Project
      const clip = adjustmentClip('', range.start)
      clip.duration = range.duration
      clip.name = tt(`fx.${type}`)
      clip.effect = { type, amount: def.amount }
      // Effects go on the topmost visual track so they affect everything below them.
      const top = p.tracks[p.tracks.length - 1]
      const free = top && top.kind === 'video' && !top.main && !top.locked && isRangeFree(p, top.id, clip.start, clip.start + clip.duration)
      clip.trackId = (free ? top : addTrack(p, 'video')).id
      d.clips[clip.id] = clip
      id = clip.id
    },
    ID
  )
  if (id) editorActions.select([id])
}

function EffectsPanel() {
  const t = useStrings(strings)
  const [thumbs, setThumbs] = useState<Map<EffectType, string> | null>(null)
  useEffect(() => {
    let live = true
    void effectThumbs(EFFECTS).then((m) => live && setThumbs(m))
    return () => {
      live = false
    }
  }, [])
  const item = (icon: React.ReactNode, label: string, hint: string, onClick: () => void) => (
    <div className={s.area}>
      <Button size="sm" icon={icon} onClick={onClick}>
        {label}
      </Button>
      <span className={s.hint}>{hint}</span>
    </div>
  )
  return (
    <div className={s.panel}>
      <span className={s.hint}>{t('applyHint')}</span>
      {GROUPS.map((group) => (
        <div key={group} className={s.group}>
          <span className={s.title}>{t(`group.${group}`)}</span>
          <div className={s.grid}>
            {EFFECTS.filter((e) => e.group === group).map((e) => (
              <button key={e.type} type="button" className={s.tile} onClick={() => addEffect(e.type)} data-effect={e.type}>
                {thumbs?.get(e.type) ? <img src={thumbs.get(e.type)} alt="" draggable={false} /> : <span className={s.thumbEmpty} />}
                <span className={s.label}>{t(`fx.${e.type}`)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <span className={s.title}>{t('areas')}</span>
      {item(<Layers />, t('adjustment'), t('adjustmentHint'), () => addAdjustment('none', t('adjustment')))}
      {item(<Droplet />, t('blur'), t('areaHint'), () => addAdjustment('blur', t('blur')))}
      {item(<Grid3x3 />, t('pixelate'), t('areaHint'), () => addAdjustment('pixelate', t('pixelate')))}
    </div>
  )
}

function EffectSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const effect = (clip as AdjustmentClip).effect
  const split = effect.type.startsWith('split')
  return (
    <Section title={t('section')}>
      <Field label={t('type')}>
        <Select<EffectType>
          value={effect.type}
          label={t('type')}
          onChange={(type) =>
            editClip(ID, clip.id, t('edit'), (c) => {
              const fx = (c as Draft<AdjustmentClip>).effect
              // Layers still named after their effect follow the new one.
              if (fx.type !== 'none' && c.name === tt(`fx.${fx.type}`)) c.name = tt(`fx.${type}`)
              fx.type = type
              fx.amount = EFFECTS.find((e) => e.type === type)?.amount ?? fx.amount
            })
          }
          options={[{ value: 'none' as EffectType, label: t('fx.none') }, ...EFFECTS.map((e) => ({ value: e.type as EffectType, label: t(`fx.${e.type}`) }))]}
        />
      </Field>
      {effect.type !== 'none' && (effectNeedsAmount(effect.type) || split) && (
        <Field label={split ? t('gap') : t('amount')}>
          <ScrubNumber
            value={effect.amount * 100}
            min={0}
            max={100}
            step={1}
            unit="%"
            label={split ? t('gap') : t('amount')}
            {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<AdjustmentClip>).effect.amount = v / 100))}
          />
        </Field>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'effects', title: () => tt('panel'), icon: Blend, order: 16, Component: EffectsPanel }],
  inspector: [{ id: 'adjustment.effect', tab: 'video', order: 6, when: (c) => c.kind === 'adjustment', Component: EffectSection }]
})
