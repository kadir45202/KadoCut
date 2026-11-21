import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from './ffmpeg'
import { paths } from './paths'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS])

/** Must run before app `ready`. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

/**
 * Only media files, or files inside Maker's own folders, may be served — the renderer can never
 * read arbitrary files (documents, keys...) through this protocol.
 */
function isAllowed(path: string): boolean {
  if (MEDIA_EXTENSIONS.has(extname(path).toLowerCase())) return true
  const roots = [paths.cacheDir(), paths.projectsDir(), paths.sfxDir(), paths.fontsDir(), paths.templatesDir()]
  return roots.some((root) => path.startsWith(resolve(root) + sep))
}

const CORS = { 'Access-Control-Allow-Origin': '*' }

export function handleMediaProtocol() {
  protocol.handle('media', async (request) => {
    const url = new URL(request.url)
    const path = resolve(decodeURIComponent(url.pathname.slice(1)))
    if (!isAllowed(path)) return new Response('Forbidden', { status: 403, headers: CORS })

    let size: number
    try {
      size = (await stat(path)).size
    } catch {
      return new Response('Not found', { status: 404, headers: CORS })
    }
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = request.headers.get('range')
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null

    if (match && size > 0) {
      let start = match[1] ? Number(match[1]) : 0
      let end = match[2] ? Number(match[2]) : size - 1
      if (!match[1] && match[2]) {
        start = Math.max(0, size - Number(match[2]))
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start > end) {
        return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${size}` } })
      }
      const stream = createReadStream(path, { start, end })
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          ...CORS,
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1)
        }
      })
    }

    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, {
      status: 200,
      headers: { ...CORS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) }
    })
  })
}
