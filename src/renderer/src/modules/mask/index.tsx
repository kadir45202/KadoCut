import type { Draft } from 'immer'
import type { Clip, Mask, MaskType } from '@shared/project/schema'
import { defaultMask } from '@shared/project/defaults'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { useStrings } from '@renderer/i18n'
import { ScrubNumber, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { MaskOverlay } from './MaskOverlay'
import { maskT, strings } from './strings'
import s from './mask.module.css'

const ID = 'mask'
type Masked = Extract<Clip, { mask: Mask }>
const TYPES: MaskType[] = ['none', 'linear', 'mirror', 'circle', 'rectangle', 'heart', 'star']

function ShapeIcon({ type }: { type: MaskType }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }
  return (
    <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden>
      {type === 'none' && <path d="M5 19 19 5M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" {...common} />}
      {type === 'linear' && <path d="M3 12h18M3 12v8h18v-8" {...common} />}
      {type === 'mirror' && <path d="M3 8h18M3 16h18" {...common} />}
      {type === 'circle' && <circle cx="12" cy="12" r="8" {...common} />}
      {type === 'rectangle' && <rect x="4" y="6" width="16" height="12" rx="1.5" {...common} />}
      {type === 'heart' && <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" {...common} />}
      {type === 'star' && <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z" {...common} />}
    </svg>
  )
}

function MaskSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const mask = (clip as Masked).mask
  const bind = (label: string, write: (m: Draft<Mask>, v: number) => void) =>
    bindClipNumber(ID, clip.id, label, (c, v) => write((c as Draft<Masked>).mask, v))

  const setType = (type: MaskType) =>
    editClip(ID, clip.id, t('change'), (c) => {
      const m = (c as Draft<Masked>).mask
      if (m.type === 'none' && type !== 'none') Object.assign(m, defaultMask(), { type })
      else m.type = type
    })

  return (
    <Section title={t('section')}>
      <div className={s.types}>
        {TYPES.map((type) => (
          <button key={type} type="button" className={s.type} data-active={mask.type === type} title={t(`type.${type}`)} aria-label={t(`type.${type}`)} onClick={() => setType(type)}>
            <ShapeIcon type={type} />
          </button>
        ))}
      </div>
      {mask.type !== 'none' && (
        <>
          <Field label={t('x')}>
            <ScrubNumber value={mask.cx * 100} step={0.5} precision={1} unit="%" {...bind(t('x'), (m, v) => void (m.cx = v / 100))} />
          </Field>
          <Field label={t('y')}>
            <ScrubNumber value={mask.cy * 100} step={0.5} precision={1} unit="%" {...bind(t('y'), (m, v) => void (m.cy = v / 100))} />
          </Field>
          {mask.type !== 'linear' && (
            <>
              {mask.type !== 'mirror' && (
                <Field label={t('width')}>
                  <ScrubNumber value={mask.width * 100} min={1} max={400} step={0.5} precision={1} unit="%" {...bind(t('width'), (m, v) => void (m.width = v / 100))} />
                </Field>
              )}
              <Field label={mask.type === 'mirror' ? t('band') : t('height')}>
                <ScrubNumber value={mask.height * 100} min={1} max={400} step={0.5} precision={1} unit="%" {...bind(t('height'), (m, v) => void (m.height = v / 100))} />
              </Field>
            </>
          )}
          <Field label={t('rotation')}>
            <ScrubNumber value={mask.rotation} step={0.5} precision={1} unit="°" {...bind(t('rotation'), (m, v) => void (m.rotation = v))} />
          </Field>
          <Field label={t('feather')}>
            <ScrubNumber value={mask.feather * 100} min={0} max={100} step={0.5} precision={0} unit="%" {...bind(t('feather'), (m, v) => void (m.feather = v / 100))} />
          </Field>
          {mask.type === 'rectangle' && (
            <Field label={t('roundness')}>
              <ScrubNumber value={mask.roundness * 100} min={0} max={100} step={0.5} precision={0} unit="%" {...bind(t('roundness'), (m, v) => void (m.roundness = v / 100))} />
            </Field>
          )}
          <Field label={t('invert')}>
            <Switch checked={mask.invert} label={t('invert')} onChange={(v) => editClip(ID, clip.id, t('invert'), (c) => void ((c as Draft<Masked>).mask.invert = v))} />
          </Field>
        </>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => maskT('name'),
  description: () => maskT('desc'),
  inspector: [{ id: 'mask.section', tab: 'video', order: 30, when: (c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'adjustment', Component: MaskSection }],
  viewer: [{ id: 'mask.handles', order: 20, when: (c) => (c.kind === 'video' || c.kind === 'image' || c.kind === 'adjustment') && c.mask.type !== 'none', Component: MaskOverlay }]
})
