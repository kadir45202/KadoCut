import { create } from 'zustand'
import type { Photo } from '@shared/photo'
import { mediaUrl } from '@renderer/lib/api'
import { log } from '@renderer/lib/api'
import { PhotoRenderer, croppedSize } from './develop'
import { developKey } from './presets'

/** Decodes a photo (EXIF orientation applied), scaled so its long edge is at most `maxEdge`. */
export async function loadPhotoBitmap(photo: Pick<Photo, 'path' | 'preview'>, maxEdge = Infinity): Promise<ImageBitmap> {
  const res = await fetch(mediaUrl(photo.preview || photo.path))
  if (!res.ok) throw new Error(`Cannot read ${photo.path} (${res.status})`)
  const full = await createImageBitmap(await res.blob(), { imageOrientation: 'from-image' })
  const long = Math.max(full.width, full.height)
  if (long <= maxEdge) return full
  const k = maxEdge / long
  const scaled = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' })
  full.close()
  return scaled
}

const THUMB_EDGE = 420
const SOURCE_CACHE = 160

/** Rendered thumbnails (JPEG data URLs) by photo id; components subscribe to this. */
export const useThumbs = create<{ urls: Record<string, string> }>(() => ({ urls: {} }))

const done = new Map<string, string>() // photo id → develop key the thumbnail shows
const sources = new Map<string, ImageBitmap>() // small decoded copies, oldest first
const queue = new Map<string, Photo>()
let renderer: PhotoRenderer | null = null
let running = false

async function sourceFor(photo: Photo): Promise<ImageBitmap> {
  let bmp = sources.get(photo.id)
  if (bmp) {
    sources.delete(photo.id)
    sources.set(photo.id, bmp)
    return bmp
  }
  bmp = await loadPhotoBitmap(photo, THUMB_EDGE * 1.5)
  sources.set(photo.id, bmp)
  while (sources.size > SOURCE_CACHE) {
    const [oldest, old] = sources.entries().next().value as [string, ImageBitmap]
    old.close()
    sources.delete(oldest)
  }
  return bmp
}

async function pump() {
  if (running) return
  running = true
  try {
    while (queue.size) {
      const [id, photo] = queue.entries().next().value as [string, Photo]
      queue.delete(id)
      const key = developKey(photo.develop)
      if (done.get(id) === key) continue
      try {
        const src = await sourceFor(photo)
        renderer ??= new PhotoRenderer(document.createElement('canvas'))
        renderer.setImage(src, src.width, src.height)
        const size = croppedSize(src.width, src.height, photo.develop.crop, THUMB_EDGE)
        renderer.render(photo.develop, size.width, size.height)
        const url = (renderer.canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.85)
        done.set(id, key)
        useThumbs.setState((s) => ({ urls: { ...s.urls, [id]: url } }))
      } catch (err) {
        log.warn('photos', `thumbnail failed: ${String(err)}`)
        done.set(id, key)
      }
      // Let the UI breathe between photos.
      await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    running = false
  }
}

/** Queues a (re)render of the thumbnail when the photo's settings changed since the last one. */
export function requestThumb(photo: Photo) {
  if (done.get(photo.id) === developKey(photo.develop)) return
  queue.set(photo.id, photo)
  void pump()
}

export function forgetThumb(id: string) {
  done.delete(id)
  sources.get(id)?.close()
  sources.delete(id)
  useThumbs.setState((s) => {
    const urls = { ...s.urls }
    delete urls[id]
    return { urls }
  })
}
