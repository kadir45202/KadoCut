import type { Draft } from 'immer'
import type { Clip, Project } from '@shared/project/schema'
import type { GestureHandlers } from '@renderer/ui/controls'
import { useEditor } from '../store/editor'
import { projectActions } from '../store/project'

type ClipWriter<V> = (clip: Draft<Clip>, value: V, project: Draft<Project>) => void

/** Applies an edit to one clip, attributed to a module for diagnostics. */
export function editClip(moduleId: string, clipId: string, label: string, fn: (clip: Draft<Clip>, project: Draft<Project>) => void): boolean {
  return projectActions.apply(
    label,
    (d) => {
      const clip = d.clips[clipId]
      if (!clip) throw new Error('Clip no longer exists')
      fn(clip, d)
    },
    moduleId
  )
}

/**
 * Binds a numeric control (ScrubNumber / Slider) to a clip property. Drags become a single undo
 * step; typed values and keyboard nudges apply immediately.
 */
export function bindClipNumber(moduleId: string, clipId: string, label: string, write: ClipWriter<number>): GestureHandlers {
  const recipe = (v: number) => (d: Draft<Project>) => {
    const clip = d.clips[clipId]
    if (clip) write(clip, v, d)
  }
  // Gesture state lives in the project store: these handlers are recreated on every render.
  return {
    onStart: () => projectActions.begin(),
    onChange: (v) => (projectActions.inGesture() ? projectActions.transient(recipe(v)) : projectActions.apply(label, recipe(v), moduleId)),
    onEnd: () => projectActions.end(label, moduleId)
  }
}

/** Same as bindClipNumber for arbitrary project edits. */
export function gestureEdit(moduleId: string, label: string) {
  return {
    onStart: () => projectActions.begin(),
    onEnd: () => projectActions.end(label, moduleId),
    set: (recipe: (d: Draft<Project>) => void) =>
      projectActions.inGesture() ? projectActions.transient(recipe) : projectActions.apply(label, recipe, moduleId)
  }
}

/** Clip-local time of the playhead (for keyframes). */
export function localPlayhead(clip: Clip): number {
  return Math.min(Math.max(useEditor.getState().playhead - clip.start, 0), clip.duration)
}
