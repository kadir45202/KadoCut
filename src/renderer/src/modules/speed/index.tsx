import type { Clip, Speed } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { isMediaClip, withSpeed, type MediaClip } from '@renderer/core/project/clip'
import { CONSTANT_MAX, CONSTANT_MIN, CURVE_PRESETS } from '@renderer/core/project/speed'
import { gestureEdit } from '@renderer/core/modules/edit'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { shortDuration } from '@renderer/lib/format'
import { Button, ScrubNumber, Segmented, Slider, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { CurveEditor, CurveThumb } from './CurveEditor'
import s from './speed.module.css'

const strings = defineStrings({
  tr: {
    name: 'Hız',
    desc: 'Sabit hız ve yumuşak geçişli hız eğrileri.',
    section: 'Hız',
    normal: 'Normal',
    curve: 'Eğri',
    rate: 'Hız',
    pitch: 'Perdeyi koru',
    duration: 'Süre',
    change: 'Hızı değiştir',
    presets: 'Hazır eğriler',
    reset: 'Sıfırla',
    editHint: 'Noktaları sürükle. Eklemek için boş yere, silmek için noktaya çift tıkla.',
    'preset.montage': 'Montaj',
    'preset.hero': 'Kahraman',
    'preset.bullet': 'Mermi',
    'preset.jumpCut': 'Atlama',
    'preset.flashIn': 'Flaş giriş',
    'preset.flashOut': 'Flaş çıkış',
    'preset.custom': 'Özel'
  },
  en: {
    name: 'Speed',
    desc: 'Constant speed and smooth speed ramps.',
    section: 'Speed',
    normal: 'Normal',
    curve: 'Curve',
    rate: 'Speed',
    pitch: 'Preserve pitch',
    duration: 'Duration',
    change: 'Change speed',
    presets: 'Presets',
    reset: 'Reset',
    editHint: 'Drag points. Double-click empty space to add, a point to remove.',
    'preset.montage': 'Montage',
    'preset.hero': 'Hero',
    'preset.bullet': 'Bullet',
    'preset.jumpCut': 'Jump cut',
    'preset.flashIn': 'Flash in',
    'preset.flashOut': 'Flash out',
    'preset.custom': 'Custom'
  }
})
const ID = 'speed'
const PRESET_IDS = ['montage', 'hero', 'bullet', 'jumpCut', 'flashIn', 'flashOut', 'custom'] as const

// Log-scale slider: 0.1x … 100x
const toSlider = (r: number) => Math.log(r / CONSTANT_MIN) / Math.log(CONSTANT_MAX / CONSTANT_MIN)
const fromSlider = (v: number) => Math.round(CONSTANT_MIN * (CONSTANT_MAX / CONSTANT_MIN) ** v * 100) / 100

/** Speed edits keep the source range; clip duration (and the magnetic track) follow. */
function speedRecipe(clipId: string, speed: Speed) {
  return (d: { clips: Record<string, Clip> }) => {
    const clip = d.clips[clipId]
    if (clip && isMediaClip(clip)) d.clips[clipId] = withSpeed(clip, speed)
  }
}

function SpeedSection({ clip: c }: { clip: Clip }) {
  const t = useStrings(strings)
  const clip = c as MediaClip
  const speed = clip.speed
  const edit = gestureEdit(ID, t('change'))
  const set = (next: Speed) => edit.set(speedRecipe(clip.id, next))
  const gesture = { onStart: edit.onStart, onEnd: edit.onEnd }

  return (
    <Section title={t('section')}>
      <Segmented
        block
        value={speed.mode}
        onChange={(mode) =>
          set(mode === 'constant' ? { mode: 'constant', rate: 1, preservePitch: true } : { mode: 'curve', preset: 'custom', points: CURVE_PRESETS.custom })
        }
        options={[
          { value: 'constant', label: t('normal') },
          { value: 'curve', label: t('curve') }
        ]}
      />
      {speed.mode === 'constant' ? (
        <>
          <Field label={t('rate')}>
            <Slider min={0} max={1} step={0.001} value={toSlider(speed.rate)} {...gesture} onChange={(v) => set({ ...speed, rate: fromSlider(v) })} />
            <div style={{ width: 70 }}>
              <ScrubNumber
                value={speed.rate}
                min={CONSTANT_MIN}
                max={CONSTANT_MAX}
                step={0.05}
                precision={2}
                unit="x"
                {...gesture}
                onChange={(rate) => set({ ...speed, rate })}
              />
            </div>
          </Field>
          <div className={s.chips}>
            {[0.5, 1, 1.5, 2, 3, 5].map((r) => (
              <button key={r} type="button" className={s.chip} data-active={Math.abs(speed.rate - r) < 1e-3} onClick={() => set({ ...speed, rate: r })}>
                {r}x
              </button>
            ))}
          </div>
          <Field label={t('pitch')}>
            <Switch checked={speed.preservePitch} onChange={(preservePitch) => set({ ...speed, preservePitch })} label={t('pitch')} />
          </Field>
        </>
      ) : (
        <>
          <div className={s.presetGrid}>
            {PRESET_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className={s.preset}
                data-active={speed.preset === id}
                onClick={() => set({ mode: 'curve', preset: id, points: CURVE_PRESETS[id] })}
              >
                <CurveThumb points={CURVE_PRESETS[id]} />
                <span>{t(`preset.${id}`)}</span>
              </button>
            ))}
          </div>
          <CurveEditor points={speed.points} {...gesture} onChange={(points) => set({ mode: 'curve', preset: 'custom', points })} />
          <div className={s.hint}>{t('editHint')}</div>
          <Button size="sm" onClick={() => set({ mode: 'curve', preset: speed.preset, points: CURVE_PRESETS[speed.preset] ?? CURVE_PRESETS.custom })}>
            {t('reset')}
          </Button>
        </>
      )}
      <Field label={t('duration')}>
        <span className="tabular">{shortDuration(clip.duration)}</span>
      </Field>
    </Section>
  )
}

const tt = stringsT(strings)

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [{ id: 'speed.main', tab: 'speed', order: 10, when: (c) => isMediaClip(c), Component: SpeedSection }]
})
