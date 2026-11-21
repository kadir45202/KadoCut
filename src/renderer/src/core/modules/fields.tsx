import type { Draft } from 'immer'
import { Diamond } from 'lucide-react'
import type { Animated, Clip } from '@shared/project/schema'
import { evalAnimated, keyIndexAt, removeKeyframe, setAnimatedValue, setKeyframe } from '../project/keyframes'
import { useEditor } from '../store/editor'
import { translate } from '@renderer/i18n'
import { IconButton, ScrubNumber } from '@renderer/ui/controls'
import { Field } from '@renderer/ui/layout'
import { bindClipNumber, editClip } from './edit'

interface AnimatedFieldProps {
  moduleId: string
  clip: Clip
  label: string
  /** Reads the animated property (works on drafts too). */
  get(clip: Clip): Animated
  set(clip: Draft<Clip>, value: Animated): void
  /** Stored value → displayed value (e.g. 0.5 → 50 %). */
  toDisplay?(v: number): number
  fromDisplay?(v: number): number
  unit?: string
  step?: number
  min?: number
  max?: number
  precision?: number
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/**
 * A number row with a keyframe diamond. Editing a property that already has keyframes adds or
 * updates the keyframe at the playhead; the diamond toggles a keyframe at the playhead.
 */
export function AnimatedField({ moduleId, clip, label, get, set, toDisplay = (v) => v, fromDisplay = (v) => v, unit, step = 1, min, max, precision = 0 }: AnimatedFieldProps) {
  const playhead = useEditor((st) => st.playhead)
  const local = clamp(playhead - clip.start, 0, clip.duration)
  const anim = get(clip)
  const value = evalAnimated(anim, local)
  const hasKeyHere = keyIndexAt(anim, local) >= 0
  const animated = anim.keys.length > 0

  const handlers = bindClipNumber(moduleId, clip.id, label, (c, v) => {
    const l = clamp(useEditor.getState().playhead - c.start, 0, c.duration)
    set(c, setAnimatedValue(get(c as Clip), l, fromDisplay(v)))
  })

  const toggleKey = () =>
    editClip(moduleId, clip.id, translate(hasKeyHere ? 'keyframe.remove' : 'keyframe.add'), (c) => {
      const a = get(c as Clip)
      set(c, hasKeyHere ? removeKeyframe(a, local) : setKeyframe(a, local, evalAnimated(a, local)))
    })

  return (
    <Field label={label}>
      <div style={{ flex: 1 }}>
        <ScrubNumber value={toDisplay(value)} step={step} min={min} max={max} precision={precision} unit={unit} {...handlers} label={label} />
      </div>
      <IconButton small label={translate(hasKeyHere ? 'keyframe.remove' : 'keyframe.add')} active={hasKeyHere} onClick={toggleKey}>
        <Diamond style={{ opacity: animated || hasKeyHere ? 1 : 0.45, fill: hasKeyHere ? 'currentColor' : 'none' }} />
      </IconButton>
    </Field>
  )
}
