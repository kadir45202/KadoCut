import type { Draft } from 'immer'
import { AlignCenter, AlignLeft, AlignRight, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Clip, Project, TextClip, TextStyle } from '@shared/project/schema'
import { defaultTextStyle } from '@shared/project/defaults'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { retimeWords } from '@renderer/core/project/clip'
import { textClip } from '@renderer/core/project/factory'
import { findOrCreateFreeTrack } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { stringsT, useStrings } from '@renderer/i18n'
import { FontPicker } from './FontPicker'
import { TITLE_TEMPLATES, placeTemplate, type TitleTemplate } from './templates'
import { strings } from './strings'
import { Button, ColorInput, ScrubNumber, Segmented, Select, Switch, TextArea, useDebounced } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import s from './text.module.css'

const tt = stringsT(strings)
const ID = 'text'

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900]

const PRESETS: Record<'title' | 'subtitle' | 'bold' | 'minimal', Partial<TextStyle>> = {
  title: { fontWeight: 800, fontSize: 0.065 },
  subtitle: { fontWeight: 600, fontSize: 0.038, backgroundOpacity: 0.65, shadow: false },
  bold: { fontWeight: 900, fontSize: 0.055, uppercase: true, strokeWidth: 0.14, color: '#FFD60A' },
  minimal: { fontWeight: 400, fontSize: 0.035, shadow: false }
}

export function addText(style: Partial<TextStyle> = {}) {
  const at = useEditor.getState().playhead
  let id = ''
  projectActions.apply(
    tt('add'),
    (d) => {
      const clip = textClip('', at, tt('placeholder'))
      clip.style = { ...defaultTextStyle(), ...style }
      clip.trackId = findOrCreateFreeTrack(d as Project, 'text', at, at + clip.duration).id
      d.clips[clip.id] = clip
      id = clip.id
    },
    ID
  )
  if (id) {
    editorActions.select([id])
    editorActions.setInspectorTab('text')
  }
}

function addTemplate(tpl: TitleTemplate) {
  const at = useEditor.getState().playhead
  let ids: string[] = []
  projectActions.apply(tt('template.add'), (d) => void (ids = placeTemplate(d as Project, tpl, at, (key) => tt(key as Parameters<typeof tt>[0]))), ID)
  if (ids.length) editorActions.select(ids)
}

function TextPanel() {
  const t = useStrings(strings)
  return (
    <div className={s.panel}>
      <Button variant="primary" size="sm" icon={<Type />} onClick={() => addText()}>
        {t('add')}
      </Button>
      <div className={s.presets}>
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((id) => {
          const st = { ...defaultTextStyle(), ...PRESETS[id] }
          return (
            <button key={id} type="button" className={s.preset} onClick={() => addText(PRESETS[id])}>
              <span
                className={s.sample}
                style={{
                  fontWeight: st.fontWeight,
                  color: st.color,
                  textTransform: st.uppercase ? 'uppercase' : undefined,
                  WebkitTextStroke: st.strokeWidth ? `1px ${st.strokeColor}` : undefined,
                  background: st.backgroundOpacity ? `rgba(0,0,0,${st.backgroundOpacity})` : undefined
                }}
              >
                {t('sample')}
              </span>
              <span className={s.presetName}>{t(`preset.${id}`)}</span>
            </button>
          )
        })}
      </div>
      <span className={s.title}>{t('templates')}</span>
      <div className={s.templates}>
        {TITLE_TEMPLATES.map((tpl) => {
          const main = tpl.parts.find((p) => p.kind === 'text')!
          const st = { ...defaultTextStyle(), ...(main.kind === 'text' ? main.style : {}) }
          const backing = tpl.parts.find((p) => p.kind === 'shape')
          return (
            <button key={tpl.id} type="button" className={s.template} data-template={tpl.id} onClick={() => addTemplate(tpl)} title={t(`template.${tpl.id}`)}>
              <span
                className={s.templateSample}
                style={{
                  fontFamily: `"${st.fontFamily}"`,
                  fontWeight: st.fontWeight,
                  color: st.color,
                  textTransform: st.uppercase ? 'uppercase' : undefined,
                  letterSpacing: `${st.letterSpacing}em`,
                  background: st.backgroundOpacity ? st.backgroundColor : backing?.kind === 'shape' && backing.fill !== '#000000' ? backing.fill : undefined,
                  WebkitTextStroke: st.strokeWidth ? `1px ${st.strokeColor}` : undefined
                }}
              >
                {t(`template.${tpl.id}.sample`)}
              </span>
              <span className={s.presetName}>{t(`template.${tpl.id}`)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ContentSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const text = (clip as TextClip).text
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [clip.id, text])
  useDebounced(draft, 400, (value) => {
    if (value === (useProject.getState().project?.clips[clip.id] as TextClip | undefined)?.text) return
    editClip(ID, clip.id, t('edit'), (c) => {
      const tc = c as Draft<TextClip>
      tc.words = retimeWords(tc as TextClip, value)
      tc.text = value
      tc.name = value.slice(0, 40)
    })
  })
  return (
    <Section title={t('content')}>
      <TextArea value={draft} placeholder={t('placeholder')} onChange={(e) => setDraft(e.target.value)} rows={3} />
    </Section>
  )
}

function StyleSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const st = (clip as TextClip).style
  const set = (patch: Partial<TextStyle>) => editClip(ID, clip.id, t('editStyle'), (c) => void Object.assign((c as Draft<TextClip>).style, patch))
  const num = (key: keyof TextStyle, scale = 1) => bindClipNumber(ID, clip.id, t('editStyle'), (c, v) => void (((c as Draft<TextClip>).style[key] as number) = v / scale))

  return (
    <Section title={t('style')}>
      <Field label={t('font')}>
        <FontPicker value={st.fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
      </Field>
      <Field label={t('weight')}>
        <Select value={String(st.fontWeight)} onChange={(w) => set({ fontWeight: Number(w) })} options={WEIGHTS.map((w) => ({ value: String(w), label: String(w) }))} />
      </Field>
      <Field label={t('size')}>
        <ScrubNumber value={st.fontSize * 100} min={0.5} max={40} step={0.1} precision={1} {...num('fontSize', 100)} />
      </Field>
      <Field label={t('color')}>
        <ColorInput value={st.color} label={t('color')} onChange={(color) => set({ color })} />
      </Field>
      <Field label={t('align')}>
        <Segmented
          value={st.align}
          onChange={(align) => set({ align })}
          options={[
            { value: 'left', icon: <AlignLeft />, title: t('alignLeft') },
            { value: 'center', icon: <AlignCenter />, title: t('alignCenter') },
            { value: 'right', icon: <AlignRight />, title: t('alignRight') }
          ]}
        />
      </Field>
      <Field label={t('spacing')}>
        <ScrubNumber value={st.letterSpacing * 100} min={-20} max={100} step={0.5} precision={1} unit="%" {...num('letterSpacing', 100)} />
      </Field>
      <Field label={t('lineHeight')}>
        <ScrubNumber value={st.lineHeight} min={0.5} max={3} step={0.01} precision={2} {...num('lineHeight')} />
      </Field>
      <Field label={t('width')}>
        <ScrubNumber value={st.maxWidth * 100} min={5} max={100} step={1} unit="%" {...num('maxWidth', 100)} />
      </Field>
      <Field label={t('uppercase')}>
        <Switch checked={st.uppercase} label={t('uppercase')} onChange={(uppercase) => set({ uppercase })} />
      </Field>
      <Field label={t('stroke')}>
        <ColorInput value={st.strokeColor} label={t('stroke')} onChange={(strokeColor) => set({ strokeColor })} />
        <ScrubNumber value={st.strokeWidth * 100} min={0} max={50} step={0.5} precision={1} unit="%" {...num('strokeWidth', 100)} />
      </Field>
      <Field label={t('background')}>
        <ColorInput value={st.backgroundColor} label={t('background')} onChange={(backgroundColor) => set({ backgroundColor })} />
        <ScrubNumber value={st.backgroundOpacity * 100} min={0} max={100} step={1} unit="%" {...num('backgroundOpacity', 100)} label={t('opacity')} />
      </Field>
      <Field label={t('shadow')}>
        <Switch checked={st.shadow} label={t('shadow')} onChange={(shadow) => set({ shadow })} />
      </Field>
      {(clip as TextClip).role === 'caption' && (
        <>
          <Field label={t('highlight')}>
            <ColorInput value={st.highlightColor} label={t('highlight')} onChange={(highlightColor) => set({ highlightColor })} />
          </Field>
          <Field label={t('highlightMode')}>
            <Select<TextStyle['highlightMode']>
              value={st.highlightMode}
              onChange={(highlightMode) => set({ highlightMode })}
              options={(['color', 'box', 'scale', 'none'] as const).map((m) => ({ value: m, label: t(`mode.${m}`) }))}
            />
          </Field>
          <Field label={t('reveal')}>
            <Switch checked={st.reveal === 'word'} label={t('reveal')} onChange={(on) => set({ reveal: on ? 'word' : 'all' })} />
          </Field>
        </>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [{ id: 'text.add', title: () => tt('add'), keys: ['t'], keyLabel: 'T', enabled: () => !!useProject.getState().project, run: () => addText() }],
  panels: [{ id: 'text', title: () => tt('panel'), icon: Type, order: 10, Component: TextPanel }],
  inspector: [
    { id: 'text.content', tab: 'text', order: 5, when: (c) => c.kind === 'text', Component: ContentSection },
    { id: 'text.style', tab: 'text', order: 10, when: (c) => c.kind === 'text', Component: StyleSection }
  ]
})
