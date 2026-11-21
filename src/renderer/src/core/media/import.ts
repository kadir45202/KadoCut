import type { Asset, Clip, Project } from '@shared/project/schema'
import { translate } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { clipEnd } from '../project/clip'
import { clipFromAsset, newId } from '../project/factory'
import { findOrCreateFreeTrack, mainTrack, projectDuration } from '../project/timeline'
import { editorActions, useEditor } from '../store/editor'
import { currentProject, projectActions } from '../store/project'
import { analyzeAsset } from './media'

/** Probes files and adds them to the project's media pool (existing files are reused). */
export async function importFiles(paths: string[]): Promise<Asset[]> {
  if (!paths.length) return []
  const project = currentProject()
  const byPath = new Map(Object.values(project.assets).map((a) => [a.path.toLowerCase(), a]))
  const fresh = paths.filter((p) => !byPath.has(p.toLowerCase()))
  const results = fresh.length ? await api.media.probe(fresh) : []
  const added: Asset[] = []
  const failed: string[] = []
  for (const r of results) {
    if (r.ok) added.push({ ...r.asset, id: newId() })
    else failed.push(r.path.split(/[\\/]/).pop() ?? r.path)
  }
  if (added.length) {
    projectActions.apply(translate('media.import'), (d) => {
      for (const a of added) d.assets[a.id] = a
    })
    added.forEach(analyzeAsset)
  }
  if (failed.length) {
    log.warn('import', `unsupported: ${failed.join(', ')}`)
    toast.error(translate('media.importFailed'), failed.join(', '))
  }
  return paths.map((p) => byPath.get(p.toLowerCase()) ?? added.find((a) => a.path.toLowerCase() === p.toLowerCase())).filter((a): a is Asset => !!a)
}

/** Probes a file produced by a job (TTS, extracted audio, renders...) into a new asset. */
export async function probeAsset(path: string, extra: Partial<Omit<Asset, 'id' | 'path'>>): Promise<Asset> {
  const [result] = await api.media.probe([path])
  if (!result?.ok) throw new Error(result?.error ?? 'Could not read the generated file')
  return { ...result.asset, ...extra, id: newId() }
}

/** Adds an asset to the project's media pool and starts its analysis. */
export function addAsset(asset: Asset, label: string, source: string): boolean {
  const ok = projectActions.apply(label, (d) => void (d.assets[asset.id] = asset), source)
  if (ok) analyzeAsset(asset)
  return ok
}

/**
 * Places an asset on the timeline: video/images append to the magnetic main track (or go to an
 * overlay track at `at` when given), audio goes to a free audio track at the playhead.
 */
export function addAssetToTimeline(asset: Asset, opts: { at?: number; overlay?: boolean } = {}): string | null {
  let clipId: string | null = null
  const ok = projectActions.apply(translate('timeline.addClip'), (d) => {
    const p = d as Project
    let clip: Clip
    if (asset.kind === 'audio') {
      const start = opts.at ?? useEditor.getState().playhead
      clip = clipFromAsset(asset, 'pending', start)
      clip.trackId = findOrCreateFreeTrack(p, 'audio', start, start + clip.duration).id
    } else if (opts.overlay) {
      const start = opts.at ?? useEditor.getState().playhead
      clip = clipFromAsset(asset, 'pending', start)
      clip.trackId = findOrCreateFreeTrack(p, 'video', start, start + clip.duration).id
    } else {
      const main = mainTrack(p)
      const mainClips = Object.values(p.clips).filter((c) => c.trackId === main.id)
      const start = p.settings.magnetic ? mainClips.reduce((m, c) => Math.max(m, clipEnd(c)), 0) : (opts.at ?? projectDuration(p))
      clip = clipFromAsset(asset, main.id, start)
      if (!p.settings.magnetic) {
        clip.trackId = findOrCreateFreeTrack(p, 'video', start, start + clip.duration, { preferId: main.id, allowMain: true }).id
      }
    }
    p.clips[clip.id] = clip
    clipId = clip.id
  })
  if (ok && clipId) editorActions.select([clipId])
  return ok ? clipId : null
}
