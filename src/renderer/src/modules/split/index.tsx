import { ArrowLeftToLine, ArrowRightToLine, Scissors } from 'lucide-react'
import type { Clip, Project } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd, snapToFrame, splitClip, trimEnd, trimStart } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT } from '@renderer/i18n'

const strings = defineStrings({
  tr: {
    name: 'Böl ve kırp',
    desc: 'Oynatma çizgisinde böl, başını veya sonunu kes.',
    split: 'Böl',
    trimStart: 'Başını oynatma çizgisine kadar kes',
    trimEnd: 'Sonunu oynatma çizgisinden kes'
  },
  en: {
    name: 'Split & trim',
    desc: 'Split at the playhead, trim the head or tail.',
    split: 'Split',
    trimStart: 'Trim start to playhead',
    trimEnd: 'Trim end to playhead'
  }
})
const t = stringsT(strings)
const ID = 'split'

/** Selected clips under the playhead, or every unlocked clip there when nothing is selected. */
function targets(p: Project, time: number): Clip[] {
  const locked = new Set(p.tracks.filter((tr) => tr.locked).map((tr) => tr.id))
  const under = Object.values(p.clips).filter((c) => !locked.has(c.trackId) && time > c.start + 1e-6 && time < clipEnd(c) - 1e-6)
  const selection = new Set(useEditor.getState().selection)
  const selected = under.filter((c) => selection.has(c.id))
  return selected.length || selection.size ? selected : under
}

function playheadTime(p: Project) {
  return snapToFrame(useEditor.getState().playhead, p.settings.fps)
}

const canEdit = () => {
  const p = useProject.getState().project
  return !!p && targets(p, playheadTime(p)).length > 0
}

function split() {
  const p = useProject.getState().project!
  const time = playheadTime(p)
  const rightIds: string[] = []
  projectActions.apply(
    t('split'),
    (d) => {
      for (const clip of targets(p, time)) {
        const parts = splitClip(d.clips[clip.id] as Clip, time, newId(), p.settings.fps)
        if (!parts) continue
        d.clips[parts[0].id] = parts[0]
        d.clips[parts[1].id] = parts[1]
        rightIds.push(parts[1].id)
      }
    },
    ID
  )
  if (rightIds.length) editorActions.select(rightIds)
}

function trim(edge: 'start' | 'end') {
  const p = useProject.getState().project!
  const time = playheadTime(p)
  projectActions.apply(
    edge === 'start' ? t('trimStart') : t('trimEnd'),
    (d) => {
      for (const clip of targets(p, time)) {
        const asset = 'assetId' in clip ? p.assets[clip.assetId] : undefined
        d.clips[clip.id] = edge === 'start' ? trimStart(clip, time, p.settings.fps) : trimEnd(clip, time, asset, p.settings.fps)
      }
    },
    ID
  )
}

export default defineModule({
  id: ID,
  name: () => t('name'),
  description: () => t('desc'),
  commands: [
    { id: 'split.split', title: () => t('split'), keys: ['mod+b', 'mod+k'], keyLabel: 'Ctrl+B', enabled: canEdit, run: split },
    { id: 'split.trimStart', title: () => t('trimStart'), keys: ['q'], keyLabel: 'Q', enabled: canEdit, run: () => trim('start') },
    { id: 'split.trimEnd', title: () => t('trimEnd'), keys: ['w'], keyLabel: 'W', enabled: canEdit, run: () => trim('end') }
  ],
  toolbar: [
    { command: 'split.split', icon: Scissors, order: 10 },
    { command: 'split.trimStart', icon: ArrowLeftToLine, order: 11 },
    { command: 'split.trimEnd', icon: ArrowRightToLine, order: 12 }
  ],
  clipMenu: [{ command: 'split.split', icon: Scissors, order: 10 }]
})
