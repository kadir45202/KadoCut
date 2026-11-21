import { existsSync } from 'node:fs'
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, ffmpeg, probeDuration, projectFile, type JobContext } from '../context'

export async function extractAudio(input: JobInput<'audio.extract'>, ctx: JobContext): Promise<JobOutput<'audio.extract'>> {
  const path = projectFile(ctx, 'audio', 'm4a')
  const duration = await probeDuration(ctx, input.path).catch(() => 0)
  await ffmpeg(ctx, ['-i', input.path, '-vn', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', path], { duration })
  return { path, duration: await probeDuration(ctx, path) }
}

/** Pitch-preserving stretch written as raw 48 kHz stereo float — loaded like decoded audio. */
export async function stretchAudio(input: JobInput<'audio.stretch'>, ctx: JobContext): Promise<JobOutput<'audio.stretch'>> {
  const rate = Math.round(input.rate * 1000) / 1000
  const path = join(ctx.env.cacheDir, `stretch-${rate}.f32`)
  if (existsSync(path)) return { path }
  const tmp = `${path}.tmp`
  const duration = await probeDuration(ctx, input.path).catch(() => 0)
  await ffmpeg(
    ctx,
    ['-i', input.path, '-vn', '-af', `rubberband=tempo=${rate}:pitchq=quality`, '-ac', '2', '-ar', '48000', '-f', 'f32le', tmp],
    { duration }
  )
  await rename(tmp, path)
  return { path }
}

async function denoiseLocal(input: JobInput<'audio.denoise'>, ctx: JobContext): Promise<string> {
  const path = projectFile(ctx, 'denoise', 'flac')
  // Spectral subtraction with adaptive noise tracking; strength maps to 6..30 dB of reduction.
  const nr = (6 + input.strength * 24).toFixed(1)
  const filter = `highpass=f=70,afftdn=nr=${nr}:nf=-45:tn=1,lowpass=f=16000`
  const duration = await probeDuration(ctx, input.path).catch(() => 0)
  await ffmpeg(ctx, ['-i', input.path, '-vn', '-af', filter, '-ac', '2', '-ar', '48000', path], { duration })
  return path
}

async function denoiseElevenLabs(input: JobInput<'audio.denoise'>, ctx: JobContext, key: string): Promise<string> {
  const upload = projectFile(ctx, 'denoise-src', 'mp3')
  ctx.progress(0.05, 'prepare')
  await ffmpeg(ctx, ['-i', input.path, '-vn', '-ac', '1', '-ar', '44100', '-b:a', '192k', upload])
  try {
    const form = new FormData()
    form.append('audio', new Blob([await readFile(upload)], { type: 'audio/mpeg' }), 'audio.mp3')
    ctx.progress(0.2, 'upload')
    const res = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
      method: 'POST',
      headers: { 'xi-api-key': key },
      body: form,
      signal: ctx.signal
    })
    if (!res.ok) throw fail('provider', `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
    ctx.progress(0.8, 'download')
    const path = projectFile(ctx, 'denoise', 'mp3')
    await writeFile(path, Buffer.from(await res.arrayBuffer()))
    return path
  } finally {
    await unlink(upload).catch(() => {})
  }
}

export async function denoise(input: JobInput<'audio.denoise'>, ctx: JobContext): Promise<JobOutput<'audio.denoise'>> {
  const key = ctx.env.secrets.elevenlabs
  if (key) {
    try {
      return { path: await denoiseElevenLabs(input, ctx, key), provider: 'elevenlabs' }
    } catch (err) {
      if (ctx.signal.aborted) throw err
      // Cloud failed (quota, network...): still deliver a result, but say so.
      ctx.log(`ElevenLabs failed, using local: ${String(err)}`)
      return { path: await denoiseLocal(input, ctx), provider: 'local', warning: err instanceof Error ? err.message : String(err) }
    }
  }
  return { path: await denoiseLocal(input, ctx), provider: 'local' }
}
