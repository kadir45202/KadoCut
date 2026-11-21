import { create } from 'zustand'
import type { JobOutput } from '@shared/jobs'
import type { Asset } from '@shared/project/schema'
import { log, mediaUrl } from '@renderer/lib/api'
import { runJob } from '../store/jobs'

/**
 * Derived, regenerable data per media file: decoded audio, waveform peaks, filmstrip
 * thumbnails, proxies and time-stretched audio. Keyed by file path; produced by worker jobs and
 * cached on disk, so this store only tracks status.
 */

type Status = 'pending' | 'ready' | 'error'

export interface AudioInfo {
  status: Status
  data?: JobOutput<'media.audio'>
  peaks?: Float32Array
}

export interface FilmstripInfo {
  status: Status
  data?: JobOutput<'media.filmstrip'> & { url: string }
}

interface MediaState {
  audio: Record<string, AudioInfo>
  filmstrip: Record<string, FilmstripInfo>
  /** Preview copies for files Chromium cannot decode. */
  proxy: Record<string, { status: Status; path?: string }>
  /** Pitch-preserving stretches, keyed by `${path}|${rate}`. */
  stretch: Record<string, { status: Status; path?: string }>
}

export const useMedia = create<MediaState>(() => ({ audio: {}, filmstrip: {}, proxy: {}, stretch: {} }))

const set = <K extends keyof MediaState>(key: K, path: string, value: MediaState[K][string]) =>
  useMedia.setState((s) => ({ [key]: { ...s[key], [path]: value } }) as unknown as Pick<MediaState, K>)

async function loadPeaks(path: string): Promise<Float32Array> {
  const res = await fetch(mediaUrl(path))
  return new Float32Array(await res.arrayBuffer())
}

export function ensureAudio(path: string): void {
  if (useMedia.getState().audio[path]) return
  set('audio', path, { status: 'pending' })
  runJob('media.audio', { path }, 'Audio')
    .then(async (data) => set('audio', path, { status: 'ready', data, peaks: await loadPeaks(data.peaksPath) }))
    .catch((err) => {
      log.warn('media', `audio analysis failed for ${path}: ${String(err)}`)
      set('audio', path, { status: 'error' })
    })
}

export function ensureFilmstrip(path: string, duration: number): void {
  if (useMedia.getState().filmstrip[path] || duration <= 0) return
  set('filmstrip', path, { status: 'pending' })
  runJob('media.filmstrip', { path, duration }, 'Filmstrip')
    .then((data) => set('filmstrip', path, { status: 'ready', data: { ...data, url: mediaUrl(data.path) } }))
    .catch((err) => {
      log.warn('media', `filmstrip failed for ${path}: ${String(err)}`)
      set('filmstrip', path, { status: 'error' })
    })
}

/** Requested by the preview when the video element cannot decode the original file. */
export function ensureProxy(path: string): void {
  if (useMedia.getState().proxy[path]) return
  set('proxy', path, { status: 'pending' })
  runJob('media.proxy', { path }, 'Proxy')
    .then((data) => set('proxy', path, { status: 'ready', path: data.path }))
    .catch((err) => {
      log.error('media', `proxy failed for ${path}`, err)
      set('proxy', path, { status: 'error' })
    })
}

export const stretchKey = (path: string, rate: number) => `${path}|${Math.round(rate * 1000) / 1000}`

export function ensureStretch(path: string, rate: number): void {
  const key = stretchKey(path, rate)
  if (useMedia.getState().stretch[key]) return
  set('stretch', key, { status: 'pending' })
  runJob('audio.stretch', { path, rate }, 'Stretch')
    .then((data) => set('stretch', key, { status: 'ready', path: data.path }))
    .catch((err) => {
      log.warn('media', `stretch failed for ${key}: ${String(err)}`)
      set('stretch', key, { status: 'error' })
    })
}

/** Kicks off the analysis an asset needs for the timeline and preview. */
export function analyzeAsset(asset: Asset): void {
  if (asset.hasAudio) ensureAudio(asset.path)
  if (asset.kind === 'video' && !asset.hidden) ensureFilmstrip(asset.path, asset.duration)
}
