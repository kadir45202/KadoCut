import { execFile } from 'node:child_process'
import { basename, extname } from 'node:path'
import { promisify } from 'node:util'
import type { ProbeResult } from '@shared/api'
import type { EncoderInfo } from '@shared/export'
import { paths } from './paths'
import { scoped } from './logger'

const run = promisify(execFile)
const log = scoped('ffmpeg')

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.bmp']
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mts', '.m2ts', '.3gp', '.wmv']
export const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wma']

interface FfStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  duration?: string
  disposition?: { attached_pic?: number }
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

function parseRate(rate?: string): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!n || !d) return 0
  return n / d
}

export async function probe(path: string): Promise<ProbeResult> {
  const ext = extname(path).toLowerCase()
  try {
    const { stdout } = await run(
      paths.ffprobe(),
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    )
    const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: FfStream[] }
    const streams = data.streams ?? []
    const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
    const audio = streams.find((s) => s.codec_type === 'audio')
    const isImage = IMAGE_EXTENSIONS.includes(ext)
    if (!video && !audio) return { ok: false, path, error: 'No audio or video stream' }

    let width = video?.width ?? 0
    let height = video?.height ?? 0
    const rotation = video?.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation ?? Number(video?.tags?.rotate ?? 0)
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width]

    const duration = isImage ? 0 : Number(data.format?.duration ?? video?.duration ?? 0) || 0
    const kind = isImage ? 'image' : video ? 'video' : 'audio'
    return {
      ok: true,
      path,
      asset: {
        kind,
        name: basename(path),
        path,
        duration,
        width,
        height,
        fps: video && !isImage ? parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) : 0,
        hasAudio: !!audio && !isImage,
        hasVideo: !!video,
        hidden: false,
        derived: null,
        beats: [],
        transcript: null
      }
    }
  } catch (err) {
    log.error(`probe failed for ${path}`, err)
    return { ok: false, path, error: err instanceof Error ? err.message : String(err) }
  }
}

const HW_PREFERENCE = ['nvenc', 'amf', 'qsv'] as const
let encoderCache: Promise<EncoderInfo> | null = null

/** Detects hardware encoders that actually work on this machine (cached for the session). */
export function detectEncoders(): Promise<EncoderInfo> {
  encoderCache ??= (async () => {
    const test = async (encoder: string) => {
      try {
        await run(
          paths.ffmpeg(),
          ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=256x256:d=0.1', '-c:v', encoder, '-f', 'null', '-'],
          { timeout: 15_000, windowsHide: true }
        )
        return true
      } catch {
        return false
      }
    }
    const info: EncoderInfo = { h264: [], hevc: [] }
    for (const codec of ['h264', 'hevc'] as const) {
      for (const hw of HW_PREFERENCE) {
        if (await test(`${codec}_${hw}`)) info[codec].push(`${codec}_${hw}`)
      }
      info[codec].push(codec === 'h264' ? 'libx264' : 'libx265')
    }
    log.info(`encoders: ${JSON.stringify(info)}`)
    return info
  })()
  return encoderCache
}

/** Re-encodes a browser recording (WebM/Opus without a duration header) to AAC that probes and seeks well. */
export async function transcodeRecording(input: string, output: string): Promise<void> {
  await run(paths.ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', output], {
    windowsHide: true
  })
}
