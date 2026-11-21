import { useState } from 'react'
import type { Draft } from 'immer'
import { Blend, Brush, Circle, Contrast, Crop, RotateCcw, Trash2, Wand2 } from 'lucide-react'
import { HSL_BANDS, MAX_MASKS, defaultDevelop, defaultLocalAdjust, type CropAspect, type LocalAdjust, type MaskKind, type Photo, type PhotoDevelop } from '@shared/photo'
import { photoActions } from '@renderer/core/store/photos'
import { autoTone } from '@renderer/engine/photo/auto'
import { fitCrop, maxCrop, setAspect } from '@renderer/engine/photo/crop'
import { loadPhotoBitmap } from '@renderer/engine/photo/images'
import { useT, type TKey } from '@renderer/i18n'
import { Button, IconButton, ScrubNumber, Segmented, Select, Slider, Switch } from '@renderer/ui/controls'
import { CurveEditor } from '@renderer/ui/CurveEditor'
import { Section } from '@renderer/ui/layout'
import { ColorWheel } from './ColorWheel'
import { Histogram } from './Histogram'
import { useDevelopUi } from './developUi'
import s from './photos.module.css'

const BAND_COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff2d95']
const DEF = defaultDevelop()

type Path = (d: PhotoDevelop) => number

interface RowProps {
  photo: Photo
  label: string
  get: Path
  set(d: Draft<PhotoDevelop>, v: number): void
  min?: number
  max?: number
  /** Shown value = stored × scale. */
  scale?: number
  step?: number
  precision?: number
  unit?: string
}

/** Slider + number for one develop value; double-click the label to reset it. */
function Row({ photo, label, get, set, min = -100, max = 100, scale = 100, step = 1, precision = 0, unit }: RowProps) {
  const id = photo.id
  const value = get(photo.develop) * scale
  const handlers = {
    onStart: () => photoActions.begin(id),
    onChange: (v: number) => photoActions.transient(id, (d) => set(d, v / scale)),
    onEnd: () => photoActions.end(id)
  }
  return (
    <div className={s.row}>
      <span className={s.rowLabel} title={label} onDoubleClick={() => photoActions.edit(id, (d) => set(d, get(DEF)))}>
        {label}
      </span>
      <Slider min={min} max={max} step={step} value={value} label={label} {...handlers} />
      <div className={s.rowValue}>
        <ScrubNumber value={value} min={min} max={max} step={step} precision={precision} unit={unit} label={label} {...handlers} />
      </div>
    </div>
  )
}

/** A labelled slider for a view setting (not a develop value). */
function UiRow({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange(v: number): void }) {
  return (
    <div className={s.row}>
      <span className={s.rowLabel} title={label}>
        {label}
      </span>
      <Slider min={min} max={max} step={step} value={value} label={label} onChange={onChange} />
      <div className={s.rowValue}>
        <ScrubNumber value={value} min={min} max={max} step={step} precision={step < 1 ? 1 : 0} unit={unit} label={label} onChange={onChange} />
      </div>
    </div>
  )
}

const MASK_ICONS = { brush: Brush, linear: Blend, radial: Circle }
const LOCAL: { key: keyof LocalAdjust; label: TKey }[] = [
  { key: 'exposure', label: 'photo.exposure' },
  { key: 'contrast', label: 'photo.contrast' },
  { key: 'highlights', label: 'photo.highlights' },
  { key: 'shadows', label: 'photo.shadows' },
  { key: 'clarity', label: 'photo.clarity' },
  { key: 'dehaze', label: 'photo.dehaze' },
  { key: 'temp', label: 'photo.temp' },
  { key: 'tint', label: 'photo.tint' },
  { key: 'saturation', label: 'photo.saturation' }
]

/** Local adjustments: add a brush / linear / radial mask, pick one, and set what it changes. */
function Masks({ photo }: { photo: Photo }) {
  const t = useT()
  const id = photo.id
  const { mask: selected, overlay, brush } = useDevelopUi()
  const masks = photo.develop.masks
  const current = masks.find((m) => m.id === selected)
  const add = (kind: MaskKind) => {
    const mid = photoActions.addMask(id, kind)
    if (mid) useDevelopUi.setState({ mask: mid, cropping: false, before: false })
  }
  const inMask = (d: PhotoDevelop) => d.masks.find((m) => m.id === selected)
  const setBrush = (patch: Partial<typeof brush>) => useDevelopUi.setState({ brush: { ...brush, ...patch } })
  return (
    <>
      <div className={s.maskAdd}>
        {(['brush', 'linear', 'radial'] as const).map((kind) => {
          const Icon = MASK_ICONS[kind]
          return (
            <Button key={kind} size="sm" icon={<Icon />} disabled={masks.length >= MAX_MASKS} onClick={() => add(kind)}>
              {t(`photo.mask.${kind}`)}
            </Button>
          )
        })}
      </div>
      {masks.map((m, i) => {
        const Icon = MASK_ICONS[m.kind]
        return (
          <div key={m.id} className={s.maskItem} data-selected={m.id === selected}>
            <button type="button" className={s.preset} data-testid="mask-item" onClick={() => useDevelopUi.setState({ mask: m.id === selected ? null : m.id })}>
              <Icon />
              {t('photo.maskName', { n: i + 1, kind: t(`photo.mask.${m.kind}`) })}
            </button>
            <IconButton
              small
              active={m.invert}
              label={t('photo.maskInvert')}
              onClick={() =>
                photoActions.edit(id, (d) => {
                  const x = d.masks.find((q) => q.id === m.id)
                  if (x) x.invert = !x.invert
                })
              }
            >
              <Contrast />
            </IconButton>
            <IconButton
              small
              label={t('photo.maskDelete')}
              onClick={() => {
                photoActions.removeMask(id, m.id)
                if (selected === m.id) useDevelopUi.setState({ mask: null })
              }}
            >
              <Trash2 />
            </IconButton>
          </div>
        )
      })}
      {!current && <span className={s.hint}>{masks.length ? t('photo.maskPick') : t('photo.maskHint')}</span>}
      {current && (
        <>
          <div className={s.basicTop}>
            <span className={s.rowLabel}>{t('photo.maskOverlay')} (O)</span>
            <Switch checked={overlay} label={t('photo.maskOverlay')} onChange={(v) => useDevelopUi.setState({ overlay: v })} />
          </div>
          {current.kind === 'brush' && (
            <>
              <UiRow label={t('photo.brushSize')} value={Math.round(brush.size * 1000) / 10} min={0.5} max={25} step={0.5} unit="%" onChange={(v) => setBrush({ size: v / 100 })} />
              <UiRow label={t('photo.feather')} value={Math.round(brush.feather * 100)} min={0} max={100} onChange={(v) => setBrush({ feather: v / 100 })} />
              <div className={s.basicTop}>
                <span className={s.rowLabel}>{t('photo.brushErase')} (Alt)</span>
                <Switch checked={brush.erase} label={t('photo.brushErase')} onChange={(erase) => setBrush({ erase })} />
              </div>
              <span className={s.hint}>{t('photo.brushHint')}</span>
            </>
          )}
          {current.kind === 'radial' && (
            <>
              <Row
                photo={photo}
                label={t('photo.feather')}
                get={(d) => {
                  const m = inMask(d)
                  return m?.kind === 'radial' ? m.feather : 0.5
                }}
                set={(d, v) => {
                  const m = inMask(d)
                  if (m?.kind === 'radial') m.feather = v
                }}
                min={0}
              />
              <Row
                photo={photo}
                label={t('photo.angle')}
                get={(d) => {
                  const m = inMask(d)
                  return m?.kind === 'radial' ? m.angle : 0
                }}
                set={(d, v) => {
                  const m = inMask(d)
                  if (m?.kind === 'radial') m.angle = v
                }}
                min={-180}
                max={180}
                scale={1}
                unit="°"
              />
            </>
          )}
          {current.kind !== 'brush' && <span className={s.hint}>{t(current.kind === 'radial' ? 'photo.radialHint' : 'photo.linearHint')}</span>}
          <div className={s.basicTop}>
            <span className={s.group}>{t('photo.maskAdjust')}</span>
            <IconButton
              small
              label={t('photo.resetAll')}
              onClick={() =>
                photoActions.edit(id, (d) => {
                  const m = inMask(d)
                  if (m) m.adjust = defaultLocalAdjust()
                })
              }
            >
              <RotateCcw />
            </IconButton>
          </div>
          {LOCAL.map(({ key, label }) => (
            <Row
              key={key}
              photo={photo}
              label={t(label)}
              get={(d) => inMask(d)?.adjust[key] ?? 0}
              set={(d, v) => {
                const m = inMask(d)
                if (m) m.adjust[key] = v
              }}
              {...(key === 'exposure' ? { min: -4, max: 4, scale: 1, step: 0.05, precision: 2 } : {})}
            />
          ))}
        </>
      )}
    </>
  )
}

async function runAuto(photo: Photo) {
  const bmp = await loadPhotoBitmap(photo, 256)
  const c = document.createElement('canvas')
  c.width = bmp.width
  c.height = bmp.height
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(bmp, 0, 0)
  bmp.close()
  const auto = autoTone(g.getImageData(0, 0, c.width, c.height).data)
  photoActions.edit(photo.id, (d) => void Object.assign(d, auto))
}

export function DevelopPanel({ photo }: { photo: Photo }) {
  const t = useT()
  const id = photo.id
  const dev = photo.develop
  const [hslMode, setHslMode] = useState<'hue' | 'sat' | 'lum'>('hue')
  const cropping = useDevelopUi((st) => st.cropping)
  const row = (label: TKey, get: Path, set: RowProps['set'], extra: Partial<RowProps> = {}) => <Row photo={photo} label={t(label)} get={get} set={set} {...extra} />
  const setCrop = (next: PhotoDevelop['crop']) => photoActions.edit(id, (d) => void (d.crop = next))
  const W = photo.width
  const H = photo.height

  return (
    <div className={s.develop} data-testid="develop-panel">
      <div className={s.histogramBox}>
        <Histogram />
        <span className={s.meta}>
          {photo.name} · {photo.width}×{photo.height}
        </span>
      </div>

      <Section
        title={t('photo.basic')}
        actions={
          <IconButton small label={t('photo.resetAll')} onClick={() => photoActions.reset([id])}>
            <RotateCcw />
          </IconButton>
        }
      >
        <div className={s.basicTop}>
          <Segmented<'color' | 'mono'>
            value={dev.mono ? 'mono' : 'color'}
            onChange={(v) => photoActions.edit(id, (d) => void (d.mono = v === 'mono'))}
            options={[
              { value: 'color', label: t('photo.color') },
              { value: 'mono', label: t('photo.mono') }
            ]}
          />
          <Button size="sm" icon={<Wand2 />} onClick={() => void runAuto(photo)}>
            {t('photo.auto')}
          </Button>
        </div>
        <span className={s.group}>{t('photo.wb')}</span>
        {row('photo.temp', (d) => d.temp, (d, v) => void (d.temp = v))}
        {row('photo.tint', (d) => d.tint, (d, v) => void (d.tint = v))}
        <span className={s.group}>{t('photo.tone')}</span>
        {row('photo.exposure', (d) => d.exposure, (d, v) => void (d.exposure = v), { min: -5, max: 5, scale: 1, step: 0.05, precision: 2 })}
        {row('photo.contrast', (d) => d.contrast, (d, v) => void (d.contrast = v))}
        {row('photo.highlights', (d) => d.highlights, (d, v) => void (d.highlights = v))}
        {row('photo.shadows', (d) => d.shadows, (d, v) => void (d.shadows = v))}
        {row('photo.whites', (d) => d.whites, (d, v) => void (d.whites = v))}
        {row('photo.blacks', (d) => d.blacks, (d, v) => void (d.blacks = v))}
        <span className={s.group}>{t('photo.presence')}</span>
        {row('photo.texture', (d) => d.texture, (d, v) => void (d.texture = v))}
        {row('photo.clarity', (d) => d.clarity, (d, v) => void (d.clarity = v))}
        {row('photo.dehaze', (d) => d.dehaze, (d, v) => void (d.dehaze = v))}
        {row('photo.vibrance', (d) => d.vibrance, (d, v) => void (d.vibrance = v))}
        {row('photo.saturation', (d) => d.saturation, (d, v) => void (d.saturation = v))}
      </Section>

      <Section title={t('photo.masks')} defaultOpen={dev.masks.length > 0}>
        <Masks photo={photo} />
      </Section>

      <Section title={t('photo.curve')} defaultOpen={false}>
        <CurveEditor
          curves={dev.curves}
          labels={{
            title: t('photo.curve'),
            channel: { master: t('photo.channel.master'), r: t('photo.channel.r'), g: t('photo.channel.g'), b: t('photo.channel.b') },
            preset: { contrast: t('photo.curvePreset.contrast'), fade: t('photo.curvePreset.fade'), bright: t('photo.curvePreset.bright') },
            hint: t('photo.curveHint')
          }}
          onBegin={() => photoActions.begin(id)}
          onTransient={(next) => photoActions.transient(id, (d) => void (d.curves = next))}
          onEnd={() => photoActions.end(id)}
          onSet={(next) => photoActions.edit(id, (d) => void (d.curves = next))}
        />
      </Section>

      <Section title={dev.mono ? t('photo.bwMix') : t('photo.mixer')} defaultOpen={false}>
        {!dev.mono && (
          <Segmented<'hue' | 'sat' | 'lum'>
            value={hslMode}
            onChange={setHslMode}
            block
            options={[
              { value: 'hue', label: t('photo.hue') },
              { value: 'sat', label: t('photo.sat') },
              { value: 'lum', label: t('photo.lum') }
            ]}
          />
        )}
        {HSL_BANDS.map((band, i) => {
          const mode = dev.mono ? 'lum' : hslMode
          return (
            <div key={band} className={s.bandRow}>
              <span className={s.bandDot} style={{ background: BAND_COLORS[i] }} />
              <Row photo={photo} label={t(`photo.band.${band}`)} get={(d) => d.hsl[mode][i]} set={(d, v) => void (d.hsl[mode][i] = v)} />
            </div>
          )
        })}
      </Section>

      {!dev.mono && (
        <Section title={t('photo.grading')} defaultOpen={false}>
          <div className={s.wheels}>
            {(['shadows', 'midtones', 'highlights'] as const).map((range) => (
              <ColorWheel
                key={range}
                label={t(`photo.range.${range}`)}
                hue={dev.grading[range].hue}
                sat={dev.grading[range].sat}
                onBegin={() => photoActions.begin(id)}
                onChange={(hue, sat) => photoActions.transient(id, (d) => void Object.assign(d.grading[range], { hue, sat }))}
                onEnd={() => photoActions.end(id)}
                onReset={() => photoActions.edit(id, (d) => void Object.assign(d.grading[range], { hue: 0, sat: 0 }))}
              />
            ))}
          </div>
          {(['shadows', 'midtones', 'highlights'] as const).map((range) => (
            <Row key={range} photo={photo} label={`${t(`photo.range.${range}`)} · ${t('photo.lum')}`} get={(d) => d.grading[range].lum} set={(d, v) => void (d.grading[range].lum = v)} />
          ))}
          {row('photo.blending', (d) => d.grading.blending, (d, v) => void (d.grading.blending = v), { min: 0 })}
          {row('photo.balance', (d) => d.grading.balance, (d, v) => void (d.grading.balance = v))}
        </Section>
      )}

      <Section title={t('photo.detail')} defaultOpen={false}>
        <span className={s.group}>{t('photo.sharpening')}</span>
        {row('photo.amount', (d) => d.sharpen.amount, (d, v) => void (d.sharpen.amount = v), { min: 0, max: 150, scale: 100 })}
        {row('photo.radius', (d) => d.sharpen.radius, (d, v) => void (d.sharpen.radius = v), { min: 0.5, max: 3, scale: 1, step: 0.1, precision: 1 })}
        {row('photo.masking', (d) => d.sharpen.masking, (d, v) => void (d.sharpen.masking = v), { min: 0 })}
        <span className={s.group}>{t('photo.noise')}</span>
        {row('photo.noiseLum', (d) => d.noise.luminance, (d, v) => void (d.noise.luminance = v), { min: 0 })}
        {row('photo.noiseColor', (d) => d.noise.color, (d, v) => void (d.noise.color = v), { min: 0 })}
      </Section>

      <Section title={t('photo.effects')} defaultOpen={false}>
        <span className={s.group}>{t('photo.vignette')}</span>
        {row('photo.amount', (d) => d.vignette.amount, (d, v) => void (d.vignette.amount = v))}
        {row('photo.midpoint', (d) => d.vignette.midpoint, (d, v) => void (d.vignette.midpoint = v), { min: 0 })}
        {row('photo.feather', (d) => d.vignette.feather, (d, v) => void (d.vignette.feather = v), { min: 0 })}
        <span className={s.group}>{t('photo.grain')}</span>
        {row('photo.amount', (d) => d.grain.amount, (d, v) => void (d.grain.amount = v), { min: 0 })}
        {row('photo.size', (d) => d.grain.size, (d, v) => void (d.grain.size = v), { min: 0 })}
      </Section>

      <Section title={t('photo.lens')} defaultOpen={false}>
        <span className={s.group}>{t('photo.lensCorrections')}</span>
        {row('photo.distortion', (d) => d.lens.distortion, (d, v) => void (d.lens.distortion = v))}
        {row('photo.lensVignette', (d) => d.lens.vignette, (d, v) => void (d.lens.vignette = v))}
        {row('photo.caRed', (d) => d.lens.caRed, (d, v) => void (d.lens.caRed = v))}
        {row('photo.caBlue', (d) => d.lens.caBlue, (d, v) => void (d.lens.caBlue = v))}
        <span className={s.group}>{t('photo.transform')}</span>
        {row('photo.vertical', (d) => d.transform.vertical, (d, v) => void (d.transform.vertical = v))}
        {row('photo.horizontal', (d) => d.transform.horizontal, (d, v) => void (d.transform.horizontal = v))}
        {row('photo.scale', (d) => d.transform.scale, (d, v) => void (d.transform.scale = v), { min: -50, max: 50 })}
        <span className={s.hint}>{t('photo.lensHint')}</span>
      </Section>

      <Section title={t('photo.crop')} defaultOpen={cropping}>
        <div className={s.basicTop}>
          <Button size="sm" variant={cropping ? 'primary' : 'secondary'} icon={<Crop />} onClick={() => useDevelopUi.setState({ cropping: !cropping })}>
            {cropping ? t('photo.cropDone') : t('photo.cropTool')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCrop(maxCrop('original', 0, W, H))}>
            {t('photo.cropReset')}
          </Button>
        </div>
        <div className={s.row}>
          <span className={s.rowLabel}>{t('photo.aspect')}</span>
          <Select<CropAspect>
            value={dev.crop.aspect}
            label={t('photo.aspect')}
            onChange={(aspect) => setCrop(aspect === 'free' ? { ...dev.crop, aspect } : setAspect(dev.crop, aspect, W, H))}
            options={(['original', 'free', '1:1', '4:5', '3:2', '16:9', '9:16'] as CropAspect[]).map((a) => ({
              value: a,
              label: a === 'original' ? t('photo.aspectOriginal') : a === 'free' ? t('photo.aspectFree') : a
            }))}
          />
        </div>
        <Row
          photo={photo}
          label={t('photo.angle')}
          get={(d) => d.crop.angle}
          set={(d, v) => void (d.crop = fitCrop({ ...d.crop, angle: v }, W, H))}
          min={-45}
          max={45}
          scale={1}
          step={0.1}
          precision={1}
          unit="°"
        />
      </Section>
    </div>
  )
}
