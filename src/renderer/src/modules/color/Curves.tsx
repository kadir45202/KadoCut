import type { Draft } from 'immer'
import { RotateCcw } from 'lucide-react'
import type { Clip, Curves, ImageClip, Project, VideoClip } from '@shared/project/schema'
import { defaultCurves } from '@shared/project/defaults'
import { editClip } from '@renderer/core/modules/edit'
import { projectActions } from '@renderer/core/store/project'
import { CurveEditor, type CurveEditorLabels } from '@renderer/ui/CurveEditor'
import { IconButton } from '@renderer/ui/controls'
import { Section } from '@renderer/ui/layout'

type Visual = VideoClip | ImageClip

/** Tone curves of a clip (or adjustment layer), one undo step per drag. */
export function CurvesSection({ clip, moduleId, labels }: { clip: Clip; moduleId: string; labels: CurveEditorLabels & { reset: string; edit: string } }) {
  const curves = (clip as Visual).color.curves
  const write = (next: Curves) => (d: Draft<Project>) => {
    const c = d.clips[clip.id] as Draft<Visual> | undefined
    if (c) c.color.curves = next
  }
  const set = (next: Curves) => editClip(moduleId, clip.id, labels.edit, (c) => void ((c as Draft<Visual>).color.curves = next))
  const neutral = (Object.keys(curves) as (keyof Curves)[]).every((k) => curves[k].length === 2 && curves[k].every((p) => p.x === p.y))
  return (
    <Section
      title={labels.title}
      defaultOpen={!neutral}
      actions={
        <IconButton small label={labels.reset} onClick={() => set(defaultCurves())}>
          <RotateCcw />
        </IconButton>
      }
    >
      <CurveEditor
        curves={curves}
        labels={labels}
        onBegin={() => projectActions.begin()}
        onTransient={(next) => projectActions.transient(write(next))}
        onEnd={() => projectActions.end(labels.edit, moduleId)}
        onSet={set}
      />
    </Section>
  )
}
