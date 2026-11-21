import type { Draft } from 'immer'
import { ArrowRight, Circle, Heart, Minus, RectangleHorizontal, Shapes, Star, Triangle } from 'lucide-react'
import type { Clip, Project, ShapeClip, ShapeType, TextStyle } from '@shared/project/schema'
import { defaultAnim, defaultTextStyle } from '@shared/project/defaults'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { shapeClip, textClip } from '@renderer/core/project/factory'
import { findOrCreateFreeTrack, projectDuration } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions } from '@renderer/core/store/project'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, ColorInput, ScrubNumber, Select } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import s from './graphics.module.css'

const strings = defineStrings({
  tr: {
    name: 'Grafikler',
    desc: 'Şekiller, emoji çıkartmaları, çağrı etiketleri ve video ilerleme çubuğu ekler.',
    panel: 'Grafik',
    shapes: 'Şekiller',
    stickers: 'Çıkartmalar',
    callouts: 'Etiketler',
    progress: 'İlerleme çubuğu',
    addProgress: 'Video boyunca ilerleme çubuğu ekle',
    add: 'Grafik ekle',
    edit: 'Şekli düzenle',
    section: 'Şekil',
    type: 'Tür',
    fill: 'Dolgu',
    track: 'Arka',
    stroke: 'Kontur',
    radius: 'Köşe',
    width: 'Genişlik',
    height: 'Yükseklik',
    rectangle: 'Dikdörtgen',
    ellipse: 'Elips',
    triangle: 'Üçgen',
    star: 'Yıldız',
    heart: 'Kalp',
    arrow: 'Ok',
    line: 'Çizgi',
    'callout.subscribe': 'ABONE OL',
    'callout.follow': 'TAKİP ET',
    'callout.new': 'YENİ',
    'callout.link': 'Link açıklamada 👇'
  },
  en: {
    name: 'Graphics',
    desc: 'Adds shapes, emoji stickers, call-out labels and a video progress bar.',
    panel: 'Graphics',
    shapes: 'Shapes',
    stickers: 'Stickers',
    callouts: 'Labels',
    progress: 'Progress bar',
    addProgress: 'Add a progress bar for the whole video',
    add: 'Add graphic',
    edit: 'Edit shape',
    section: 'Shape',
    type: 'Type',
    fill: 'Fill',
    track: 'Track',
    stroke: 'Outline',
    radius: 'Corners',
    width: 'Width',
    height: 'Height',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    triangle: 'Triangle',
    star: 'Star',
    heart: 'Heart',
    arrow: 'Arrow',
    line: 'Line',
    'callout.subscribe': 'SUBSCRIBE',
    'callout.follow': 'FOLLOW',
    'callout.new': 'NEW',
    'callout.link': 'Link in description 👇'
  }
})
const tt = stringsT(strings)
const ID = 'graphics'

const SHAPES: { type: Exclude<ShapeType, 'progress'>; icon: React.ComponentType }[] = [
  { type: 'rectangle', icon: RectangleHorizontal },
  { type: 'ellipse', icon: Circle },
  { type: 'triangle', icon: Triangle },
  { type: 'star', icon: Star },
  { type: 'heart', icon: Heart },
  { type: 'arrow', icon: ArrowRight },
  { type: 'line', icon: Minus }
]

const EMOJI = ['😀', '😂', '😍', '🥳', '😎', '🤯', '😱', '🤔', '👍', '👏', '🙌', '👉', '👀', '🔥', '✨', '💯', '❤️', '⭐', '🎉', '💡', '📌', '✅', '❌', '🚀']

const CALLOUTS: { id: 'subscribe' | 'follow' | 'new' | 'link'; style: Partial<TextStyle> }[] = [
  { id: 'subscribe', style: { backgroundColor: '#FF3B30', backgroundOpacity: 1, fontWeight: 800, shadow: false } },
  { id: 'follow', style: { backgroundColor: '#0A84FF', backgroundOpacity: 1, fontWeight: 800, shadow: false } },
  { id: 'new', style: { backgroundColor: '#FFD60A', backgroundOpacity: 1, color: '#000000', fontWeight: 900, shadow: false } },
  { id: 'link', style: { backgroundColor: '#000000', backgroundOpacity: 0.65, fontWeight: 600, fontSize: 0.035, shadow: false } }
]

/** Adds a clip on a free graphics track at the playhead and selects it. */
function addGraphic(build: (start: number, project: Project) => Clip) {
  const at = useEditor.getState().playhead
  let id = ''
  projectActions.apply(
    tt('add'),
    (d) => {
      const clip = build(at, d as Project)
      clip.trackId = findOrCreateFreeTrack(d as Project, 'text', clip.start, clip.start + clip.duration).id
      d.clips[clip.id] = clip
      id = clip.id
    },
    ID
  )
  if (id) editorActions.select([id])
}

function addEmoji(emoji: string) {
  addGraphic((at) => {
    const clip = textClip('', at, emoji)
    clip.style = { ...defaultTextStyle(), fontFamily: 'Segoe UI Emoji', fontWeight: 400, fontSize: 0.1, shadow: false }
    clip.anim = { ...defaultAnim(), in: { type: 'pop', duration: 0.35 } }
    return clip
  })
}

function addCallout(callout: (typeof CALLOUTS)[number]) {
  addGraphic((at) => {
    const clip = textClip('', at, tt(`callout.${callout.id}`))
    clip.style = { ...defaultTextStyle(), ...callout.style }
    clip.anim = { ...defaultAnim(), in: { type: 'pop', duration: 0.35 }, loop: callout.id === 'subscribe' ? { type: 'pulse', period: 1.2 } : defaultAnim().loop }
    return clip
  })
}

function GraphicsPanel() {
  const t = useStrings(strings)
  return (
    <div className={s.panel}>
      <span className={s.title}>{t('shapes')}</span>
      <div className={s.grid}>
        {SHAPES.map(({ type, icon: Icon }) => (
          <button key={type} type="button" className={s.tile} title={t(type)} onClick={() => addGraphic((at, p) => ({ ...shapeClip('', at, type, p.settings), name: t(type) }))}>
            <Icon />
          </button>
        ))}
      </div>
      <span className={s.title}>{t('stickers')}</span>
      <div className={s.grid}>
        {EMOJI.map((e) => (
          <button key={e} type="button" className={`${s.tile} ${s.emoji}`} onClick={() => addEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <span className={s.title}>{t('callouts')}</span>
      <div className={s.callouts}>
        {CALLOUTS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={s.callout}
            style={{ background: c.style.backgroundColor, color: c.style.color ?? '#fff', opacity: c.style.backgroundOpacity === 1 ? 1 : 0.85 }}
            onClick={() => addCallout(c)}
          >
            {t(`callout.${c.id}`)}
          </button>
        ))}
      </div>
      <span className={s.title}>{t('progress')}</span>
      <Button
        size="sm"
        onClick={() =>
          addGraphic((_, p) => {
            const clip = { ...shapeClip('', 0, 'progress', p.settings), name: t('progress') }
            clip.duration = Math.max(0.5, projectDuration(p))
            return clip
          })
        }
      >
        {t('addProgress')}
      </Button>
    </div>
  )
}

function ShapeSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const shape = clip as ShapeClip
  const set = (patch: Partial<ShapeClip>) => editClip(ID, clip.id, t('edit'), (c) => void Object.assign(c as Draft<ShapeClip>, patch))
  const num = (key: 'width' | 'height' | 'strokeWidth' | 'radius') => bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<ShapeClip>)[key] = v / 100))
  return (
    <Section title={t('section')}>
      {shape.shape !== 'progress' && (
        <Field label={t('type')}>
          <Select<ShapeType> value={shape.shape} onChange={(type) => set({ shape: type })} options={SHAPES.map(({ type }) => ({ value: type, label: t(type) }))} />
        </Field>
      )}
      <Field label={t('fill')}>
        <ColorInput value={shape.fill} label={t('fill')} onChange={(fill) => set({ fill })} />
      </Field>
      {shape.shape === 'progress' && (
        <Field label={t('track')}>
          <ColorInput value={shape.secondary} label={t('track')} onChange={(secondary) => set({ secondary })} />
        </Field>
      )}
      <Field label={t('stroke')}>
        <ColorInput value={shape.stroke} label={t('stroke')} onChange={(stroke) => set({ stroke })} />
        <ScrubNumber value={shape.strokeWidth * 100} min={0} max={50} step={0.5} precision={1} unit="%" label={t('stroke')} {...num('strokeWidth')} />
      </Field>
      {(shape.shape === 'rectangle' || shape.shape === 'progress') && (
        <Field label={t('radius')}>
          <ScrubNumber value={shape.radius * 100} min={0} max={100} step={1} unit="%" label={t('radius')} {...num('radius')} />
        </Field>
      )}
      <Field label={t('width')}>
        <ScrubNumber value={shape.width * 100} min={0.5} max={200} step={0.5} precision={1} unit="%" label={t('width')} {...num('width')} />
      </Field>
      <Field label={t('height')}>
        <ScrubNumber value={shape.height * 100} min={0.2} max={200} step={0.1} precision={1} unit="%" label={t('height')} {...num('height')} />
      </Field>
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'graphics', title: () => tt('panel'), icon: Shapes, order: 12, Component: GraphicsPanel }],
  inspector: [{ id: 'graphics.shape', tab: 'video', order: 8, when: (c) => c.kind === 'shape', Component: ShapeSection }]
})
