import { create } from 'zustand'
import type { Clip } from '@shared/project/schema'

export const ZOOM_MIN = 8
export const ZOOM_MAX = 1200

interface EditorState {
  selection: string[]
  playhead: number
  playing: boolean
  /** Timeline zoom in pixels per second. */
  pxPerSec: number
  leftPanel: string
  inspectorTab: string
  /** Copied clips with times relative to the earliest one. */
  clipboard: Clip[]
  /** Cut point the user clicked (id of the clip right of the cut), for transitions. */
  cutClipId: string | null
  /** Empty stretch of a track selected for closing (ripple). */
  gap: { trackId: string; start: number; end: number } | null
}

export const useEditor = create<EditorState>(() => ({
  selection: [],
  playhead: 0,
  playing: false,
  pxPerSec: 80,
  leftPanel: 'media',
  inspectorTab: 'video',
  clipboard: [],
  cutClipId: null,
  gap: null
}))

export const editorActions = {
  reset() {
    useEditor.setState({ selection: [], playhead: 0, playing: false, clipboard: [], cutClipId: null, gap: null })
  },
  select(ids: string[], additive = false) {
    const current = useEditor.getState().selection
    if (!additive) {
      useEditor.setState({ selection: ids, gap: null, cutClipId: ids.length === 1 && ids[0] === useEditor.getState().cutClipId ? ids[0] : null })
      return
    }
    const set = new Set(current)
    for (const id of ids) {
      if (set.has(id)) set.delete(id)
      else set.add(id)
    }
    useEditor.setState({ selection: [...set] })
  },
  /** Focuses the cut before `clipId` and opens the transitions panel. */
  focusCut(clipId: string) {
    useEditor.setState({ selection: [clipId], cutClipId: clipId, gap: null, leftPanel: 'transitions' })
  },
  selectGap(gap: EditorState['gap']) {
    useEditor.setState({ gap, selection: [], cutClipId: null })
  },
  setPlayhead(t: number) {
    useEditor.setState({ playhead: Math.max(0, t) })
  },
  setZoom(pxPerSec: number) {
    useEditor.setState({ pxPerSec: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, pxPerSec)) })
  },
  setLeftPanel(id: string) {
    useEditor.setState({ leftPanel: id })
  },
  setInspectorTab(id: string) {
    useEditor.setState({ inspectorTab: id })
  }
}

export const selectedIds = () => useEditor.getState().selection
