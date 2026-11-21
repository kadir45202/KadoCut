import { Group, Ungroup } from 'lucide-react'
import type { Project } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT } from '@renderer/i18n'
import { toast } from '@renderer/ui/toast'
import { groupClips, ungroupClip } from './group'

const strings = defineStrings({
  tr: {
    name: 'İç içe sekans',
    desc: 'Seçili klipleri tek bir klipte gruplar; grup birlikte taşınır, kırpılır ve dönüştürülür.',
    group: 'Grupla (iç içe sekans)',
    ungroup: 'Grubu çöz',
    groupName: 'Grup',
    nothing: 'Gruplamak için en az iki klip seç.',
    nested: 'Bir grup başka bir grubun içine konamaz.',
    blocked: 'Seçimin arasında seçilmemiş klipler var; onları da seç ya da kenara çek.',
    transformLost: 'Grubun konum/ölçek ayarı içteki kliplere aktarılmadı.'
  },
  en: {
    name: 'Compound clips',
    desc: 'Nests the selected clips into one clip that moves, trims and transforms as a unit.',
    group: 'Group (compound clip)',
    ungroup: 'Ungroup',
    groupName: 'Group',
    nothing: 'Select at least two clips to group.',
    nested: 'A group cannot go inside another group.',
    blocked: 'Unselected clips sit between the selected ones; select them too or move them away.',
    transformLost: 'The group’s position/scale was not carried over to its clips.'
  }
})
const tt = stringsT(strings)
const ID = 'compound'

const selected = () => {
  const p = useProject.getState().project
  return p ? useEditor.getState().selection.map((id) => p.clips[id]).filter(Boolean) : []
}

function group() {
  let result = { error: 'nothing' } as ReturnType<typeof groupClips>
  const ok = projectActions.apply(tt('group'), (d) => void (result = groupClips(d as Project, useEditor.getState().selection, tt('groupName'))), ID)
  if ('error' in result) toast.info(tt(result.error))
  else if (ok) editorActions.select([result.id])
}

function ungroup() {
  const clip = selected()[0]
  if (clip?.kind !== 'compound') return
  const t = clip.transform
  const moved = [t.x, t.y, t.rotation].some((a) => a.value !== 0 || a.keys.length) || [t.scale, t.opacity].some((a) => a.value !== 1 || a.keys.length)
  let ids: string[] = []
  if (projectActions.apply(tt('ungroup'), (d) => void (ids = ungroupClip(d as Project, clip.id)), ID)) {
    editorActions.select(ids)
    if (moved) toast.info(tt('transformLost'))
  }
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    { id: 'compound.group', title: () => tt('group'), keys: ['mod+g'], keyLabel: 'Ctrl+G', enabled: () => selected().length > 1, run: group },
    { id: 'compound.ungroup', title: () => tt('ungroup'), keys: ['mod+shift+g'], keyLabel: 'Ctrl+Shift+G', enabled: () => selected()[0]?.kind === 'compound', run: ungroup }
  ],
  clipMenu: [
    { command: 'compound.group', icon: Group, order: 70, separatorBefore: true },
    { command: 'compound.ungroup', icon: Ungroup, order: 71 }
  ]
})
