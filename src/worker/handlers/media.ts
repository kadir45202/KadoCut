import { createReadStream, existsSync } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobInput, JobOutput } from '@shared/jobs'
import { ffmpeg, probeDuration, projectFile, type JobContext } from '../context'

const SAMPLE_RATE = 48_000
const CHANNELS = 2
const PEAKS_PER_SECOND = 100

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Max |sample| per bucket, both channels mixed — enough to draw a waveform. */
async function computePeaks(pcmPath: string, peaksPath: string): Promise<number> {
  const perPeak = SAMPLE_RATE / PEAKS_PER_SECOND
  const frameBytes = CHANNELS * 4
  const peaks: number[] = []
  let current = 0
  let count = 0
  let carry: Buffer = Buffer.alloc(0)
  for await (const chunk of createReadStream(pcmPath, { highWaterMark: frameBytes * 8192 })) {
    const buf: Buffer = carry.length ? Buffer.concat([carry, chunk as Buffer]) : (chunk as Buffer)
    const usable = buf.length - (buf.length % frameBytes)
    for (let off = 0; off < usable; off += frameBytes) {
      const l = Math.abs(buf.readFloatLE(off))
      const r = Math.abs(buf.readFloatLE(off + 4))
      current = Math.max(current, l, r)
      if (++count >= perPeak) {
        peaks.push(current)
        current = 0
        count = 0
      }
    }
    carry = buf.subarray(usable)
  }
  if (count) peaks.push(current)
  await writeFile(peaksPath, Buffer.from(new Float32Array(peaks).buffer))
  return peaks.length
}

export async function analyzeAudio(input: JobInput<'media.audio'>, ctx: JobContext): Promise<JobOutput<'media.audio'>> {
  const dir = ctx.env.cacheDir
  const metaPath = join(dir, 'audio.json')
  const cached = await readJson<JobOutput<'media.audio'>>(metaPath)
  if (cached && existsSync(cached.pcmPath) && existsSync(cached.peaksPath)) return cached

  const pcmPath = join(dir, 'audio.f32')
  const peaksPath = join(dir, 'audio.peaks')
  const tmp = `${pcmPath}.tmp`
  const duration = await durationOf(ctx, input.path)
  await ffmpeg(ctx, ['-i', input.path, '-vn', '-ac', String(CHANNELS), '-ar', String(SAMPLE_RATE), '-f', 'f32le', tmp], { duration })
  await rename(tmp, pcmPath)
  ctx.progress(0.95, 'peaks')
  await computePeaks(pcmPath, peaksPath)
  const frames = (await stat(pcmPath)).size / (CHANNELS * 4)
  const output = { pcmPath, peaksPath, sampleRate: SAMPLE_RATE, channels: CHANNELS, frames, peaksPerSecond: PEAKS_PER_SECOND }
  await writeFile(metaPath, JSON.stringify(output))
  return output
}

async function durationOf(ctx: JobContext, path: string): Promise<number> {
  try {
    return await probeDuration(ctx, path)
  } catch {
    return 0
  }
}

const TILE_HEIGHT = 96
const MAX_TILES = 60

export async function filmstrip(input: JobInput<'media.filmstrip'>, ctx: JobContext): Promise<JobOutput<'media.filmstrip'>> {
  const dir = ctx.env.cacheDir
  const metaPath = join(dir, 'filmstrip.json')
  const cached = await readJson<JobOutput<'media.filmstrip'>>(metaPath)
  if (cached && existsSync(cached.path)) return cached

  const count = Math.max(1, Math.min(MAX_TILES, Math.ceil(input.duration)))
  const interval = Math.max(input.duration / count, 0.04)
  const path = join(dir, 'filmstrip.jpg')
  const args = (keyframesOnly: boolean) => [
    ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
    '-i', input.path,
    '-an',
    // MJPEG needs full-range YUV.
    '-vf', `fps=1/${interval.toFixed(4)},scale=-2:${TILE_HEIGHT},format=yuvj420p,tile=${count}x1`,
    '-frames:v', '1',
    '-q:v', '5',
    path
  ]
  // Long files: decode keyframes only (fast). Short files may have a single keyframe, so they
  // (and any fast-path failure) use a full decode.
  let done = false
  if (input.duration > 30) {
    done = await ffmpeg(ctx, args(true)).then(() => existsSync(path), () => false)
  }
  if (!done) await ffmpeg(ctx, args(false))
  const { width } = pngOrJpegSize(await readFile(path))
  const output = { path, count, interval, tileWidth: Math.round(width / count), tileHeight: TILE_HEIGHT }
  await writeFile(metaPath, JSON.stringify(output))
  return output
}

export async function proxy(input: JobInput<'media.proxy'>, ctx: JobContext): Promise<JobOutput<'media.proxy'>> {
  const path = join(ctx.env.cacheDir, 'proxy.mp4')
  if (existsSync(path)) return { path }
  const tmp = join(ctx.env.cacheDir, 'proxy.tmp.mp4')
  const duration = await durationOf(ctx, input.path)
  await ffmpeg(
    ctx,
    [
      '-i', input.path,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      // Long side at most 1920 px (portrait 4K too).
      '-vf', "scale='trunc(iw*min(1,1920/max(iw,ih))/2)*2':-2",
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      tmp
    ],
    { duration }
  )
  await rename(tmp, path)
  return { path }
}

export async function freezeFrame(input: JobInput<'media.freezeFrame'>, ctx: JobContext): Promise<JobOutput<'media.freezeFrame'>> {
  const path = projectFile(ctx, 'freeze', 'png')
  await ffmpeg(ctx, ['-ss', input.time.toFixed(6), '-i', input.path, '-frames:v', '1', '-an', path])
  const { width, height } = pngOrJpegSize(await readFile(path))
  return { path, width, height }
}

/** Reads image dimensions from PNG IHDR or JPEG SOF headers. */
function pngOrJpegSize(buf: Buffer): { width: number; height: number } {
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  let off = 2
  while (off < buf.length) {
    if (buf[off] !== 0xff) break
    const marker = buf[off + 1]
    const len = buf.readUInt16BE(off + 2)
    if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
    off += 2 + len
  }
  throw new Error('Unknown image format')
}
