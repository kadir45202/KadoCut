import type { Draft } from 'immer'
import { Layers, PanelBottom } from 'lucide-react'
import type { BlendMode, ChromaKey, Clip, ImageClip, Project, VideoClip } from '@shared/project/schema'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd } from '@renderer/core/project/clip'
import { findOrCreateFreeTrack, mainTrack } from '@renderer/core/project/timeline'
import { useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, ColorInput, ScrubNumber, Select, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import s from './overlay.module.css'

const strings = defineStrings({
  tr: {
    name: 'Katman (PIP) ve yeşil perde',
    desc: 'Ana videonun üstüne video/görsel yerleştirme, köşe yerleşimleri ve chroma key.',
    toOverlay: 'Katmana taşı',
    toMain: 'Ana parçaya taşı',
    layout: 'Yerleşim',
    full: 'Tam ekran',
    tl: 'Sol üst',
    tr: 'Sağ üst',
    bl: 'Sol alt',
    br: 'Sağ alt',
    center: 'Orta',
    applyLayout: 'Yerleşimi uygula',
    chroma: 'Yeşil perde (chroma key)',
    enable: 'Etkin',
    color: 'Anahtar renk',
    green: 'Yeşil',
    blue: 'Mavi',
    similarity: 'Benzerlik',
    smoothness: 'Yumuşaklık',
    spill: 'Taşma temizleme',
    chromaEdit: 'Chroma key',
    blend: 'Karışım modu',
    'blend.normal': 'Normal',
    'blend.multiply': 'Çoğalt (Multiply)',
    'blend.screen': 'Ekran (Screen)',
    'blend.overlay': 'Kaplama (Overlay)',
    'blend.darken': 'Koyulaştır',
    'blend.lighten': 'Açıklaştır',
    'blend.add': 'Ekle (Add)',
    'blend.softLight': 'Yumuşak ışık',
    'blend.difference': 'Fark'
  },
  en: {
    name: 'Overlay (PIP) & green screen',
    desc: 'Place video/images over the main video, corner layouts and chroma key.',
    toOverlay: 'Move to overlay',
    toMain: 'Move to main track',
    layout: 'Layout',
    full: 'Full screen',
    tl: 'Top left',
    tr: 'Top right',
    bl: 'Bottom left',
    br: 'Bottom right',
    center: 'Center',
    applyLayout: 'Apply layout',
    chroma: 'Green screen (chroma key)',
    enable: 'Enabled',
    color: 'Key color',
    green: 'Green',
    blue: 'Blue',
    similarity: 'Similarity',
    smoothness: 'Smoothness',
    spill: 'Spill removal',
    chromaEdit: 'Chroma key',
    blend: 'Blend mode',
    'blend.normal': 'Normal',
    'blend.multiply': 'Multiply',
    'blend.screen': 'Screen',
    'blend.overlay': 'Overlay',
    'blend.darken': 'Darken',
    'blend.lighten': 'Lighten',
    'blend.add': 'Add',
    'blend.softLight': 'Soft light',
    'blend.difference': 'Difference'
  }
})
const tt = stringsT(strings)
const ID = 'overlay'

type Visual = VideoClip | ImageClip
const isVisual = (c: Clip | undefined): c is Visual => c?.kind === 'video' || c?.kind === 'image'

function selected(): Visual | undefined {
  const p = useProject.getState().project
  const sel = useEditor.getState().selection
  const c = p && sel.length === 1 ? p.clips[sel[0]] : undefined
  return isVisual(c) ? c : undefined
}

const onMain = (p: Project, c: Clip) => c.trackId === mainTrack(p).id

function toOverlay() {
  const clip = selected()
  if (!clip) return
  projectActions.apply(
    tt('toOverlay'),
    (d) => {
      const c = d.clips[clip.id]
      c.trackId = findOrCreateFreeTrack(d as Project, 'video', c.start, clipEnd(c), { exclude: new Set([c.id]) }).id
    },
    ID
  )
}

function toMain() {
  const clip = selected()
  if (!clip) return
  projectActions.apply(
    tt('toMain'),
    (d) => {
      const draft = d as Project
      const main = mainTrack(draft)
      const c = draft.clips[clip.id]
      const order = Object.values(draft.clips).filter((x) => x.trackId === main.id).sort((a, b) => a.start - b.start)
      const after = order.filter((x) => x.start + x.duration / 2 > c.start)
      c.trackId = main.id
      if (draft.settings.magnetic) {
        c.start = after.length ? after[0].start : order.reduce((e, x) => Math.max(e, clipEnd(x)), 0)
        for (const x of after) x.start += c.duration
      }
    },
    ID
  )
}

type Slot = 'full' | 'tl' | 'tr' | 'bl' | 'br' | 'center'
const SLOTS: Slot[] = ['tl', 'tr', 'center', 'bl', 'br']

function LayoutSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const project = useProject((st) => st.project!)
  const asset = isVisual(clip) ? project.assets[clip.assetId] : undefined
  if (!asset) return null
  const { width: cw, height: ch } = project.settings
  const fit = Math.min(cw / (asset.width || cw), ch / (asset.height || ch))

  const apply = (slot: Slot) => {
    const scale = slot === 'full' ? 1 : slot === 'center' ? 0.6 : 0.42
    // Shown size as a fraction of the canvas, to place the edges a margin away from the frame.
    const wf = ((asset.width || cw) * fit * scale) / cw
    const hf = ((asset.height || ch) * fit * scale) / ch
    const m = 0.04
    const x = slot === 'tl' || slot === 'bl' ? -(0.5 - m - wf / 2) : slot === 'tr' || slot === 'br' ? 0.5 - m - wf / 2 : 0
    const y = slot === 'tl' || slot === 'tr' ? -(0.5 - m * (cw / ch) - hf / 2) : slot === 'bl' || slot === 'br' ? 0.5 - m * (cw / ch) - hf / 2 : 0
    editClip(ID, clip.id, t('applyLayout'), (c) => {
      const tr = (c as Draft<Visual>).transform
      tr.scale = { value: Math.round(scale * 1000) / 1000, keys: [] }
      tr.x = { value: Math.round(x * 1000) / 1000, keys: [] }
      tr.y = { value: Math.round(y * 1000) / 1000, keys: [] }
    })
  }

  return (
    <Section title={t('layout')}>
      <div className={s.slots} style={{ aspectRatio: `${cw} / ${ch}` }}>
        {SLOTS.map((slot) => (
          <button key={slot} type="button" className={s.slot} data-slot={slot} title={t(slot)} aria-label={t(slot)} onClick={() => apply(slot)} />
        ))}
      </div>
      <Button size="sm" onClick={() => apply('full')}>
        {t('full')}
      </Button>
    </Section>
  )
}

const BLENDS: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add', 'softLight', 'difference']

function BlendSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  return (
    <Section title={t('blend')}>
      <Field label={t('blend')}>
        <Select<BlendMode>
          label={t('blend')}
          value={(clip as Visual).blend}
          onChange={(blend) => editClip(ID, clip.id, t('blend'), (c) => void ((c as Draft<Visual>).blend = blend))}
          options={BLENDS.map((b) => ({ value: b, label: t(`blend.${b}`) }))}
        />
      </Field>
    </Section>
  )
}

function ChromaSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const chroma = (clip as Visual).chroma
  const set = (label: string, patch: Partial<ChromaKey>) => editClip(ID, clip.id, label, (c) => void Object.assign((c as Draft<Visual>).chroma, patch))
  const bind = (key: 'similarity' | 'smoothness' | 'spill', label: string) =>
    bindClipNumber(ID, clip.id, label, (c, v) => void ((c as Draft<Visual>).chroma[key] = v / 100))

  return (
    <Section title={t('chroma')} defaultOpen={chroma.enabled}>
      <Field label={t('enable')}>
        <Switch checked={chroma.enabled} label={t('chroma')} onChange={(enabled) => set(t('chromaEdit'), { enabled })} />
      </Field>
      {chroma.enabled && (
        <>
          <Field label={t('color')}>
            <ColorInput value={chroma.color} label={t('color')} onChange={(color) => set(t('chromaEdit'), { color })} />
            <Button size="sm" onClick={() => set(t('chromaEdit'), { color: '#00FF00' })}>
              {t('green')}
            </Button>
            <Button size="sm" onClick={() => set(t('chromaEdit'), { color: '#0047FF' })}>
              {t('blue')}
            </Button>
          </Field>
          <Field label={t('similarity')}>
            <ScrubNumber value={chroma.similarity * 100} min={0} max={100} unit="%" {...bind('similarity', t('similarity'))} />
          </Field>
          <Field label={t('smoothness')}>
            <ScrubNumber value={chroma.smoothness * 100} min={0} max={100} unit="%" {...bind('smoothness', t('smoothness'))} />
          </Field>
          <Field label={t('spill')}>
            <ScrubNumber value={chroma.spill * 100} min={0} max={100} unit="%" {...bind('spill', t('spill'))} />
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
  commands: [
    {
      id: 'overlay.toOverlay',
      title: () => tt('toOverlay'),
      enabled: () => {
        const c = selected()
        return !!c && onMain(useProject.getState().project!, c)
      },
      run: toOverlay
    },
    {
      id: 'overlay.toMain',
      title: () => tt('toMain'),
      enabled: () => {
        const c = selected()
        return !!c && !onMain(useProject.getState().project!, c)
      },
      run: toMain
    }
  ],
  clipMenu: [
    { command: 'overlay.toOverlay', icon: Layers, order: 40, separatorBefore: true },
    { command: 'overlay.toMain', icon: PanelBottom, order: 41 }
  ],
  inspector: [
    { id: 'overlay.layout', tab: 'video', order: 15, when: (c, p) => isVisual(c) && !onMain(p, c), Component: LayoutSection },
    { id: 'overlay.blend', tab: 'video', order: 16, when: (c, p) => isVisual(c) && !onMain(p, c), Component: BlendSection },
    { id: 'overlay.chroma', tab: 'video', order: 35, when: (c) => isVisual(c), Component: ChromaSection }
  ]
})
