import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Tensor } from 'onnxruntime-node'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, ffmpeg, projectFile, requireComponents, runProcess, type JobContext } from '../context'

interface VideoInfo {
  width: number
  height: number
  fps: number
}

async function probeVideo(ctx: JobContext, path: string): Promise<VideoInfo> {
  const out = await runProcess(ctx, ctx.env.ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate:stream_side_data=rotation',
    '-of', 'json', path
  ])
  const s = (JSON.parse(out) as { streams: { width: number; height: number; avg_frame_rate: string; side_data_list?: { rotation?: number }[] }[] }).streams[0]
  if (!s) throw fail('failed', 'No video stream')
  const [n, d] = s.avg_frame_rate.split('/').map(Number)
  const rotation = s.side_data_list?.find((x) => typeof x.rotation === 'number')?.rotation ?? 0
  const swap = Math.abs(rotation) % 180 === 90
  return { width: swap ? s.height : s.width, height: swap ? s.width : s.height, fps: n && d ? n / d : 30 }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** VP9 with an alpha plane: Chromium plays it with transparency and ffmpeg's libvpx decodes it. */
const ALPHA_ENCODE = ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '28', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-auto-alt-ref', '0']

function spawnTracked(ctx: JobContext, args: string[]): ChildProcessWithoutNullStreams {
  const proc = spawn(ctx.env.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true })
  const kill = () => proc.kill()
  ctx.signal.addEventListener('abort', kill)
  proc.on('close', () => ctx.signal.removeEventListener('abort', kill))
  return proc
}

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i

async function removeLocal(input: JobInput<'video.removeBackground'>, ctx: JobContext): Promise<string> {
  const [modelDir] = requireComponents(ctx, 'rvm-matting')
  const ort = await import('onnxruntime-node')
  const isImage = IMAGE_EXT.test(input.path)
  const info = await probeVideo(ctx, input.path)
  const scale = Math.min(1, 1920 / Math.max(info.width, info.height))
  const W = even(info.width * scale)
  const H = even(info.height * scale)
  const fps = Math.min(60, Math.round(info.fps * 1000) / 1000)
  // RVM works best when its internal resolution is ~512px on the long side.
  const downsample = Math.max(0.125, Math.min(1, 512 / Math.max(W, H)))

  let session: Awaited<ReturnType<typeof ort.InferenceSession.create>>
  try {
    session = await ort.InferenceSession.create(join(modelDir, 'rvm.onnx'), { executionProviders: ['dml', 'cpu'] })
  } catch {
    session = await ort.InferenceSession.create(join(modelDir, 'rvm.onnx'), { executionProviders: ['cpu'] })
  }

  // Stills become a PNG with alpha; videos a VP9 alpha WebM.
  const out = projectFile(ctx, 'nobg', isImage ? 'png' : 'webm')
  const decoder = spawnTracked(ctx, ['-i', input.path, '-an', '-vf', isImage ? `scale=${W}:${H}` : `fps=${fps},scale=${W}:${H}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'])
  const encoder = spawnTracked(
    ctx,
    ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', 'pipe:0', ...(isImage ? ['-frames:v', '1'] : ALPHA_ENCODE), out]
  )
  let encErr = ''
  encoder.stderr.on('data', (d: Buffer) => (encErr = (encErr + d.toString()).slice(-1000)))
  encoder.stdin.on('error', () => {})
  const encoderDone = new Promise<number | null>((r) => encoder.on('close', r))

  const pixels = W * H
  const frameBytes = pixels * 3
  const totalFrames = isImage ? 1 : Math.max(1, Math.round(input.duration * fps))
  const zero = () => new ort.Tensor('float32', new Float32Array(1), [1, 1, 1, 1])
  let rec: Tensor[] = [zero(), zero(), zero(), zero()]
  const ratio = new ort.Tensor('float32', new Float32Array([downsample]), [1])
  const src = new Float32Array(3 * pixels)
  const rgba = Buffer.alloc(pixels * 4)

  let pending: Buffer = Buffer.alloc(0)
  let frame = 0
  for await (const chunk of decoder.stdout) {
    pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer)
    while (pending.length >= frameBytes) {
      if (ctx.signal.aborted) throw fail('cancelled', 'Cancelled')
      for (let i = 0; i < pixels; i++) {
        src[i] = pending[i * 3] / 255
        src[pixels + i] = pending[i * 3 + 1] / 255
        src[2 * pixels + i] = pending[i * 3 + 2] / 255
      }
      pending = pending.subarray(frameBytes)
      const result = await session.run({
        src: new ort.Tensor('float32', src, [1, 3, H, W]),
        r1i: rec[0], r2i: rec[1], r3i: rec[2], r4i: rec[3],
        downsample_ratio: ratio
      })
      rec = [result.r1o, result.r2o, result.r3o, result.r4o]
      const fgr = result.fgr.data as Float32Array
      const pha = result.pha.data as Float32Array
      for (let i = 0; i < pixels; i++) {
        rgba[i * 4] = Math.min(255, Math.max(0, fgr[i] * 255))
        rgba[i * 4 + 1] = Math.min(255, Math.max(0, fgr[pixels + i] * 255))
        rgba[i * 4 + 2] = Math.min(255, Math.max(0, fgr[2 * pixels + i] * 255))
        rgba[i * 4 + 3] = Math.min(255, Math.max(0, pha[i] * 255))
      }
      if (!encoder.stdin.write(Buffer.from(rgba))) await new Promise((r) => encoder.stdin.once('drain', r))
      frame++
      if (frame % 5 === 0) ctx.progress(Math.min(0.98, frame / totalFrames), 'matting')
    }
  }
  encoder.stdin.end()
  const code = await encoderDone
  if (code !== 0) throw fail('failed', `Alpha encode failed: ${encErr.trim()}`)
  if (frame === 0) throw fail('failed', 'No frames decoded')
  return out
}

async function replicateJson(ctx: JobContext, key: string, url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    signal: ctx.signal
  })
  if (!res.ok) throw fail('provider', `Replicate ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<Record<string, unknown>>
}

async function removeReplicate(input: JobInput<'video.removeBackground'>, ctx: JobContext, key: string): Promise<string> {
  const info = await probeVideo(ctx, input.path)
  const scale = Math.min(1, 1920 / Math.max(info.width, info.height))
  const W = even(info.width * scale)
  const H = even(info.height * scale)
  const fps = Math.min(60, Math.round(info.fps * 1000) / 1000)
  const tmp = join(tmpdir(), `maker-rvm-${Date.now()}`)
  const upload = `${tmp}-in.mp4`
  const mask = `${tmp}-mask.mp4`
  try {
    ctx.progress(0.02, 'prepare')
    // Upload a compact copy (Replicate's file limit is 100 MB).
    await ffmpeg(ctx, ['-i', input.path, '-an', '-vf', `fps=${fps},scale=${W}:${H}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', upload])
    const form = new FormData()
    form.append('content', new Blob([await readFile(upload)], { type: 'video/mp4' }), 'input.mp4')
    ctx.progress(0.1, 'upload')
    const file = await replicateJson(ctx, key, 'https://api.replicate.com/v1/files', { method: 'POST', body: form })
    const fileUrl = (file.urls as { get: string }).get
    const model = await replicateJson(ctx, key, 'https://api.replicate.com/v1/models/arielreplicate/robust_video_matting')
    const version = (model.latest_version as { id: string }).id
    let prediction = await replicateJson(ctx, key, 'https://api.replicate.com/v1/predictions', {
      method: 'POST',
      body: JSON.stringify({ version, input: { input_video: fileUrl, output_type: 'alpha-mask' } })
    })
    const started = Date.now()
    while (!['succeeded', 'failed', 'canceled'].includes(String(prediction.status))) {
      await new Promise((r) => setTimeout(r, 2500))
      ctx.progress(Math.min(0.8, 0.15 + (Date.now() - started) / 600_000), 'processing')
      prediction = await replicateJson(ctx, key, (prediction.urls as { get: string }).get)
    }
    if (prediction.status !== 'succeeded') throw fail('provider', `Replicate: ${String(prediction.error ?? prediction.status)}`)
    const outputUrl = Array.isArray(prediction.output) ? String(prediction.output[0]) : String(prediction.output)
    ctx.progress(0.85, 'download')
    const res = await fetch(outputUrl, { signal: ctx.signal })
    if (!res.ok) throw fail('provider', `Replicate download ${res.status}`)
    await writeFile(mask, Buffer.from(await res.arrayBuffer()))

    const out = projectFile(ctx, 'nobg', 'webm')
    await ffmpeg(ctx, [
      '-i', input.path, '-i', mask,
      '-filter_complex', `[0:v]fps=${fps},scale=${W}:${H},format=rgba[c];[1:v]fps=${fps},scale=${W}:${H},format=gray[m];[c][m]alphamerge[v]`,
      '-map', '[v]', '-an', ...ALPHA_ENCODE, out
    ])
    return out
  } finally {
    await unlink(upload).catch(() => {})
    await unlink(mask).catch(() => {})
  }
}

export async function removeBackground(
  input: JobInput<'video.removeBackground'>,
  ctx: JobContext
): Promise<JobOutput<'video.removeBackground'>> {
  const key = ctx.env.secrets.replicate
  // The cloud model only accepts video; stills are always processed locally.
  if (key && !IMAGE_EXT.test(input.path)) {
    try {
      return { path: await removeReplicate(input, ctx, key), provider: 'replicate' }
    } catch (err) {
      if (ctx.signal.aborted) throw err
      const warning = err instanceof Error ? err.message : String(err)
      ctx.log(`Replicate failed, using local: ${warning}`)
      return { path: await removeLocal(input, ctx), provider: 'local', warning }
    }
  }
  return { path: await removeLocal(input, ctx), provider: 'local' }
}
