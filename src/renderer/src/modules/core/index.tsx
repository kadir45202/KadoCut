import { Copy, ClipboardPaste, Trash2 } from 'lucide-react'
import type { Project } from '@shared/project/schema'
import { importFiles } from '@renderer/core/media/import'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { findOrCreateFreeTrack, isRangeFree, projectDuration, rippleTrack, trackKindFor } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { currentProject, projectActions, useProject } from '@renderer/core/store/project'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { getPreview, seek } from '@renderer/engine/preview'
import { translate } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { exportRequests } from '@renderer/features/export/exportRequests'

const hasProject = () => !!useProject.getState().project
const hasSelection = () => hasProject() && useEditor.getState().selection.length > 0
const hasSelectionOrGap = () => hasSelection() || (hasProject() && !!useEditor.getState().gap)
const fps = () => currentProject().settings.fps
const playhead = () => useEditor.getState().playhead

function selectedUnlocked(p: Project): string[] {
  const locked = new Set(p.tracks.filter((t) => t.locked).map((t) => t.id))
  return useEditor.getState().selection.filter((id) => p.clips[id] && !locked.has(p.clips[id].trackId))
}

function closeGap() {
  const gap = useEditor.getState().gap
  if (!gap) return
  projectActions.apply(translate('timeline.closeGap'), (d) => rippleTrack(d as Project, gap.trackId, gap.end, -(gap.end - gap.start)))
  editorActions.selectGap(null)
}

function deleteSelection(ripple: boolean) {
  if (useEditor.getState().gap) return closeGap()
  const p = currentProject()
  const ids = selectedUnlocked(p)
  if (!ids.length) return
  projectActions.apply(translate(ripple ? 'edit.rippleDelete' : 'edit.delete'), (d) => {
    // Delete right-to-left so ripple shifts stay correct.
    const clips = ids.map((id) => d.clips[id]).sort((a, b) => b.start - a.start)
    for (const c of clips) {
      delete d.clips[c.id]
      if (ripple) rippleTrack(d as Project, c.trackId, c.start + c.duration, -c.duration)
    }
  })
  editorActions.select([])
}

function copySelection() {
  const p = currentProject()
  const clips = useEditor.getState().selection.map((id) => p.clips[id]).filter(Boolean)
  if (!clips.length) return
  const t0 = Math.min(...clips.map((c) => c.start))
  useEditor.setState({ clipboard: clips.map((c) => ({ ...c, start: c.start - t0 })) })
}

function paste() {
  const clipboard = useEditor.getState().clipboard
  if (!clipboard.length) return
  const at = playhead()
  const ids: string[] = []
  projectActions.apply(translate('edit.paste'), (d) => {
    const draft = d as Project
    for (const src of clipboard) {
      if ('assetId' in src && !draft.assets[src.assetId]) continue
      const clip = { ...structuredClone(src), id: newId(), start: at + src.start }
      const track = draft.tracks.find((t) => t.id === src.trackId)
      if (track?.main && draft.settings.magnetic) {
        // Insert at the playhead position in the main sequence.
        const order = Object.values(draft.clips).filter((c) => c.trackId === track.id).sort((a, b) => a.start - b.start)
        const after = order.filter((c) => c.start + c.duration / 2 > clip.start)
        clip.start = after.length ? after[0].start : order.reduce((e, c) => Math.max(e, clipEnd(c)), 0)
        for (const c of after) c.start += clip.duration
      } else if (!track || !isRangeFree(draft, track.id, clip.start, clip.start + clip.duration)) {
        clip.trackId = findOrCreateFreeTrack(draft, trackKindFor(clip.kind), clip.start, clip.start + clip.duration).id
      }
      draft.clips[clip.id] = clip
      ids.push(clip.id)
    }
  })
  editorActions.select(ids)
}

function zoomToFit() {
  const p = currentProject()
  const duration = Math.max(5, projectDuration(p))
  const width = (document.querySelector('[data-timeline-width]') as HTMLElement | null)?.clientWidth ?? window.innerWidth - 200
  editorActions.setZoom((width - 60) / duration)
}

export default defineModule({
  id: 'core',
  core: true,
  name: () => translate('module.core'),
  commands: [
    { id: 'core.undo', title: () => translate('edit.undo'), keys: ['mod+z'], keyLabel: 'Ctrl+Z', enabled: () => useProject.getState().past.length > 0, run: projectActions.undo },
    { id: 'core.redo', title: () => translate('edit.redo'), keys: ['mod+shift+z', 'mod+y'], keyLabel: 'Ctrl+Shift+Z', enabled: () => useProject.getState().future.length > 0, run: projectActions.redo },
    { id: 'core.delete', title: () => translate('edit.delete'), keys: ['delete', 'backspace'], keyLabel: 'Del', enabled: hasSelectionOrGap, run: () => deleteSelection(false) },
    { id: 'core.rippleDelete', title: () => translate('edit.rippleDelete'), keys: ['shift+delete', 'shift+backspace'], keyLabel: 'Shift+Del', enabled: hasSelectionOrGap, run: () => deleteSelection(true) },
    { id: 'core.copy', title: () => translate('edit.copy'), keys: ['mod+c'], keyLabel: 'Ctrl+C', enabled: hasSelection, run: copySelection },
    { id: 'core.paste', title: () => translate('edit.paste'), keys: ['mod+v'], keyLabel: 'Ctrl+V', enabled: () => hasProject() && useEditor.getState().clipboard.length > 0, run: paste },
    {
      id: 'core.selectAll',
      title: () => translate('edit.selectAll'),
      keys: ['mod+a'],
      enabled: hasProject,
      run: () => editorActions.select(Object.keys(currentProject().clips))
    },
    { id: 'core.playPause', title: () => translate('viewer.play'), keys: ['space'], enabled: hasProject, run: () => getPreview()?.toggle() },
    { id: 'core.play', title: () => translate('viewer.shuttleForward'), keys: ['l'], enabled: hasProject, run: () => getPreview()?.shuttle(1) },
    { id: 'core.shuttleBack', title: () => translate('viewer.shuttleBack'), keys: ['j'], enabled: hasProject, run: () => getPreview()?.shuttle(-1) },
    { id: 'core.pause', title: () => translate('viewer.pause'), keys: ['k'], enabled: hasProject, run: () => getPreview()?.pause() },
    { id: 'core.back1s', title: () => translate('viewer.back1s'), keys: ['shift+arrowleft'], enabled: hasProject, run: () => seek(playhead() - 1) },
    { id: 'core.fwd1s', title: () => translate('viewer.fwd1s'), keys: ['shift+arrowright'], enabled: hasProject, run: () => seek(playhead() + 1) },
    { id: 'core.prevFrame', title: () => translate('viewer.prevFrame'), keys: ['arrowleft'], enabled: hasProject, run: () => seek(playhead() - 1 / fps()) },
    { id: 'core.nextFrame', title: () => translate('viewer.nextFrame'), keys: ['arrowright'], enabled: hasProject, run: () => seek(playhead() + 1 / fps()) },
    { id: 'core.home', title: () => translate('viewer.start'), keys: ['home'], enabled: hasProject, run: () => seek(0) },
    { id: 'core.end', title: () => translate('viewer.end'), keys: ['end'], enabled: hasProject, run: () => seek(projectDuration(currentProject())) },
    { id: 'core.zoomIn', title: () => translate('timeline.zoomIn'), keys: ['=', 'mod+='], enabled: hasProject, run: () => editorActions.setZoom(useEditor.getState().pxPerSec * 1.5) },
    { id: 'core.zoomOut', title: () => translate('timeline.zoomOut'), keys: ['-', 'mod+-'], enabled: hasProject, run: () => editorActions.setZoom(useEditor.getState().pxPerSec / 1.5) },
    { id: 'core.zoomFit', title: () => translate('timeline.fit'), keys: ['shift+z'], enabled: hasProject, run: zoomToFit },
    {
      id: 'core.snapping',
      title: () => translate('timeline.snapping'),
      keys: ['s'],
      enabled: hasProject,
      run: () => void settingsActions.update({ snapping: !useSettings.getState().settings.snapping })
    },
    {
      id: 'core.import',
      title: () => translate('media.importButton'),
      keys: ['mod+i'],
      enabled: hasProject,
      run: async () => void (await importFiles(await api.media.pickFiles('media')))
    },
    {
      id: 'core.save',
      title: () => translate('common.save'),
      keys: ['mod+s'],
      enabled: hasProject,
      run: async () => {
        await projectActions.flush()
        toast.success(translate('save.saved'))
      }
    },
    { id: 'core.export', title: () => translate('export.button'), keys: ['mod+e'], enabled: hasProject, run: () => exportRequests.open() }
  ],
  toolbar: [{ command: 'core.delete', icon: Trash2, order: 90 }],
  clipMenu: [
    { command: 'core.copy', icon: Copy, order: 90, separatorBefore: true },
    { command: 'core.paste', icon: ClipboardPaste, order: 91 },
    { command: 'core.delete', icon: Trash2, order: 100, separatorBefore: true },
    { command: 'core.rippleDelete', order: 101 }
  ]
})
