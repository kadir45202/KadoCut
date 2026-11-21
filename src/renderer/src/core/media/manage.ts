import type { Clip, InnerClip, Project } from '@shared/project/schema'
import { projectActions, useProject } from '@renderer/core/store/project'
import { translate } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { analyzeAsset } from './media'

/** Assets the timeline uses: clip media, renders it plays (no-bg, denoise, stabilized) and LUTs. */
export function usedAssetIds(project: Project): Set<string> {
  const used = new Set<string>()
  const visit = (clip: Clip | InnerClip) => {
    if ('assetId' in clip) used.add(clip.assetId)
    if ('bgRemoval' in clip && clip.bgRemoval.assetId) used.add(clip.bgRemoval.assetId)
    if ('audio' in clip && clip.audio.denoise.assetId) used.add(clip.audio.denoise.assetId)
    if (clip.kind === 'video' && clip.stabilize.assetId) used.add(clip.stabilize.assetId)
    if ('color' in clip && clip.color.lutAssetId) used.add(clip.color.lutAssetId)
    if (clip.kind === 'compound') Object.values(clip.clips).forEach(visit)
  }
  Object.values(project.clips).forEach(visit)
  return used
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** Asks for a folder and relinks every missing file found there by name. */
export async function relinkFromFolder() {
  const { project, missing } = useProject.getState()
  if (!project || !missing.length) return
  const wanted = missing.map((id) => project.assets[id]).filter(Boolean)
  const found = await api.media.findInFolder(wanted.map((a) => fileName(a.path)))
  const hits = wanted.map((a) => ({ asset: a, path: found[fileName(a.path).toLowerCase()] })).filter((h) => h.path)
  if (!hits.length) return void toast.info(translate('media.relinkNone'))
  const probes = await api.media.probe(hits.map((h) => h.path))
  const fixed: string[] = []
  projectActions.apply(translate('media.relink'), (d) => {
    probes.forEach((probe, i) => {
      const a = d.assets[hits[i].asset.id]
      if (!a || !probe.ok || probe.asset.kind !== a.kind) return
      Object.assign(a, { ...probe.asset, id: a.id, name: a.name, hidden: a.hidden, derived: a.derived, beats: a.beats, transcript: a.transcript })
      fixed.push(a.id)
    })
  })
  projectActions.setMissing(useProject.getState().missing.filter((id) => !fixed.includes(id)))
  for (const id of fixed) analyzeAsset(useProject.getState().project!.assets[id])
  toast.success(translate('media.relinked', { count: fixed.length, total: missing.length }))
}

/** Removes media the timeline does not use (files stay on disk; undoable). */
export function removeUnused(): number {
  const project = useProject.getState().project
  if (!project) return 0
  const used = usedAssetIds(project)
  const unused = Object.keys(project.assets).filter((id) => !used.has(id))
  if (unused.length) projectActions.apply(translate('media.removeUnused'), (d) => unused.forEach((id) => delete d.assets[id]))
  return unused.length
}

/** Media files that live outside the project folder (and exist). */
export function externalAssets(project: Project, dir: string, missing: string[]) {
  const root = dir.replace(/[\\/]+$/, '').toLowerCase()
  return Object.values(project.assets).filter((a) => !missing.includes(a.id) && !a.path.toLowerCase().startsWith(root + '\\') && !a.path.toLowerCase().startsWith(root + '/'))
}

/** Copies outside media into the project folder so the project can be moved or archived. */
export async function collectMedia() {
  const { project, dir, missing } = useProject.getState()
  if (!project) return
  const external = externalAssets(project, dir, missing)
  if (!external.length) return void toast.info(translate('media.collectNone'))
  await projectActions.flush()
  const moved = await api.media.collect(project.id, external.map((a) => a.path))
  const count = Object.keys(moved).length
  if (count) {
    projectActions.apply(translate('media.collect'), (d) => {
      for (const a of Object.values(d.assets)) if (moved[a.path]) a.path = moved[a.path]
    })
    for (const a of Object.values(useProject.getState().project!.assets)) if (Object.values(moved).includes(a.path)) analyzeAsset(a)
  }
  toast.success(translate('media.collected', { count }))
}
