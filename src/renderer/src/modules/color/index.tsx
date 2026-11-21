import type { Draft } from 'immer'
import { FileUp, RotateCcw, Trash2 } from 'lucide-react'
import type { Asset, Clip, ColorAdjust, ImageClip, VideoClip } from '@shared/project/schema'
import { defaultColor } from '@shared/project/defaults'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { newId } from '@renderer/core/project/factory'
import { projectActions, useProject } from '@renderer/core/store/project'
import { loadLut } from '@renderer/engine/lut'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { Button, IconButton, ScrubNumber, Slider } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { CurvesSection } from './Curves'

const strings = defineStrings({
  tr: {
    name: 'Renk ve LUT',
    desc: 'Pozlama, kontrast, doygunluk, sıcaklık, vurgu/gölge ayarları ve .cube LUT desteği.',
    section: 'Renk ayarları',
    exposure: 'Pozlama',
    contrast: 'Kontrast',
    brightness: 'Parlaklık',
    saturation: 'Doygunluk',
    temperature: 'Sıcaklık',
    highlights: 'Vurgular',
    shadows: 'Gölgeler',
    reset: 'Renk ayarlarını sıfırla',
    lut: 'LUT',
    loadLut: 'LUT yükle (.cube)',
    intensity: 'Yoğunluk',
    removeLut: 'LUT’u kaldır',
    lutFailed: 'LUT okunamadı',
    edit: 'Renk ayarı',
    curves: 'Eğriler',
    curvesReset: 'Eğrileri sıfırla',
    curvesEdit: 'Eğri ayarı',
    'ch.master': 'Ana',
    'ch.r': 'Kırmızı',
    'ch.g': 'Yeşil',
    'ch.b': 'Mavi',
    'preset.contrast': 'Kontrast (S)',
    'preset.fade': 'Soluk film',
    'preset.bright': 'Aydınlat',
    curvesHint: 'Noktayı sürükle; boş yere tıklayıp nokta ekle, çift tıklayıp sil.'
  },
  en: {
    name: 'Color & LUT',
    desc: 'Exposure, contrast, saturation, temperature, highlights/shadows and .cube LUTs.',
    section: 'Color',
    exposure: 'Exposure',
    contrast: 'Contrast',
    brightness: 'Brightness',
    saturation: 'Saturation',
    temperature: 'Temperature',
    highlights: 'Highlights',
    shadows: 'Shadows',
    reset: 'Reset color',
    lut: 'LUT',
    loadLut: 'Load LUT (.cube)',
    intensity: 'Intensity',
    removeLut: 'Remove LUT',
    lutFailed: 'Could not read the LUT',
    edit: 'Color adjustment',
    curves: 'Curves',
    curvesReset: 'Reset curves',
    curvesEdit: 'Curve adjustment',
    'ch.master': 'Master',
    'ch.r': 'Red',
    'ch.g': 'Green',
    'ch.b': 'Blue',
    'preset.contrast': 'Contrast (S)',
    'preset.fade': 'Faded film',
    'preset.bright': 'Brighten',
    curvesHint: 'Drag a point; click empty space to add one, double-click to remove.'
  }
})
const tt = stringsT(strings)
const ID = 'color'

type Visual = VideoClip | ImageClip
type Key = Exclude<keyof ColorAdjust, 'lutAssetId' | 'lutIntensity' | 'curves'>
const SLIDERS: Key[] = ['exposure', 'contrast', 'brightness', 'saturation', 'temperature', 'highlights', 'shadows']

function ColorSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const color = (clip as Visual).color

  return (
    <Section
      title={t('section')}
      actions={
        <IconButton small label={t('reset')} onClick={() => editClip(ID, clip.id, t('reset'), (c) => void ((c as Draft<Visual>).color = { ...defaultColor(), lutAssetId: color.lutAssetId, lutIntensity: color.lutIntensity, curves: color.curves }))}>
          <RotateCcw />
        </IconButton>
      }
    >
      {SLIDERS.map((key) => {
        // Exposure is shown in stops, the rest as -100…100.
        const k = key === 'exposure' ? 1 : 100
        const range = key === 'exposure' ? 3 : 1
        const handlers = bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Visual>).color[key] = v / k))
        return (
          <Field key={key} label={t(key)}>
            <Slider min={-range * k} max={range * k} step={key === 'exposure' ? 0.05 : 1} value={color[key] * k} {...handlers} label={t(key)} />
            <div style={{ width: 58, flexShrink: 0 }}>
              <ScrubNumber value={color[key] * k} min={-range * k} max={range * k} step={key === 'exposure' ? 0.05 : 1} precision={key === 'exposure' ? 2 : 0} {...handlers} />
            </div>
          </Field>
        )
      })}
    </Section>
  )
}

async function importLut(clipId: string) {
  const project = useProject.getState().project!
  const file = await api.media.importLut(project.id)
  if (!file) return
  try {
    const lut = await loadLut(file.path)
    const asset: Asset = {
      id: newId(),
      kind: 'lut',
      name: file.name,
      path: file.path,
      duration: 0,
      width: lut.size,
      height: lut.size,
      fps: 0,
      hasAudio: false,
      hasVideo: false,
      hidden: true,
      derived: null,
      beats: [],
      transcript: null
    }
    projectActions.apply(
      tt('loadLut'),
      (d) => {
        d.assets[asset.id] = asset
        const c = d.clips[clipId] as Draft<Visual> | undefined
        if (c) c.color = { ...c.color, lutAssetId: asset.id, lutIntensity: 1 }
      },
      ID
    )
  } catch (err) {
    toast.error(tt('lutFailed'), err instanceof Error ? err.message : String(err))
  }
}

function LutSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const color = (clip as Visual).color
  const lut = useProject((st) => (color.lutAssetId ? st.project!.assets[color.lutAssetId] : undefined))
  return (
    <Section title={t('lut')}>
      {lut ? (
        <>
          <Field label={lut.name}>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 />}
              onClick={() => editClip(ID, clip.id, t('removeLut'), (c) => void ((c as Draft<Visual>).color.lutAssetId = ''))}
            >
              {t('removeLut')}
            </Button>
          </Field>
          <Field label={t('intensity')}>
            <Slider
              min={0}
              max={100}
              step={1}
              value={color.lutIntensity * 100}
              label={t('intensity')}
              {...bindClipNumber(ID, clip.id, t('intensity'), (c, v) => void ((c as Draft<Visual>).color.lutIntensity = v / 100))}
            />
          </Field>
        </>
      ) : (
        <Button size="sm" icon={<FileUp />} onClick={() => void importLut(clip.id)}>
          {t('loadLut')}
        </Button>
      )}
    </Section>
  )
}

function CurvesPanel({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  return (
    <CurvesSection
      clip={clip}
      moduleId={ID}
      labels={{
        title: t('curves'),
        reset: t('curvesReset'),
        edit: t('curvesEdit'),
        channel: { master: t('ch.master'), r: t('ch.r'), g: t('ch.g'), b: t('ch.b') },
        preset: { contrast: t('preset.contrast'), fade: t('preset.fade'), bright: t('preset.bright') },
        hint: t('curvesHint')
      }}
    />
  )
}

// Adjustment layers grade everything below them with the same controls.
const isVisual = (c: Clip) => c.kind === 'video' || c.kind === 'image' || c.kind === 'adjustment'

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [
    { id: 'color.adjust', tab: 'video', order: 45, when: isVisual, Component: ColorSection },
    { id: 'color.curves', tab: 'video', order: 45.5, when: isVisual, Component: CurvesPanel },
    { id: 'color.lut', tab: 'video', order: 46, when: isVisual, Component: LutSection }
  ]
})
