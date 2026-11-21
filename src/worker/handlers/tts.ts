import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, findFile, probeDuration, projectFile, requireComponents, runProcess, type JobContext } from '../context'

async function synthesizeLocal(input: JobInput<'tts.synthesize'>, ctx: JobContext): Promise<string> {
  const [runtime, voice] = requireComponents(ctx, 'piper-runtime', input.language === 'tr' ? 'piper-voice-tr' : 'piper-voice-en')
  const exe = findFile(runtime, 'piper.exe')
  if (!exe) throw fail('missing-component', 'piper.exe not found', ['piper-runtime'])
  const path = projectFile(ctx, 'tts', 'wav')
  ctx.progress(0.1, 'synthesize')
  await runProcess(ctx, exe, ['--model', join(voice, 'voice.onnx'), '--output_file', path], { stdin: input.text })
  return path
}

async function synthesizeElevenLabs(input: JobInput<'tts.synthesize'>, ctx: JobContext, key: string): Promise<string> {
  ctx.progress(0.1, 'request')
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(ctx.env.elevenVoiceId)}?output_format=mp3_44100_192`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text: input.text, model_id: 'eleven_multilingual_v2', language_code: input.language }),
      signal: ctx.signal
    }
  )
  if (!res.ok) throw fail('provider', `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const path = projectFile(ctx, 'tts', 'mp3')
  await writeFile(path, Buffer.from(await res.arrayBuffer()))
  return path
}

export async function synthesize(input: JobInput<'tts.synthesize'>, ctx: JobContext): Promise<JobOutput<'tts.synthesize'>> {
  const text = input.text.trim()
  if (!text) throw fail('failed', 'Text is empty')
  const key = ctx.env.secrets.elevenlabs
  let path: string
  let provider: 'local' | 'elevenlabs' = 'local'
  let warning: string | undefined
  if (key) {
    try {
      path = await synthesizeElevenLabs({ ...input, text }, ctx, key)
      provider = 'elevenlabs'
    } catch (err) {
      if (ctx.signal.aborted) throw err
      warning = err instanceof Error ? err.message : String(err)
      ctx.log(`ElevenLabs failed, using local: ${warning}`)
      path = await synthesizeLocal({ ...input, text }, ctx)
    }
  } else {
    path = await synthesizeLocal({ ...input, text }, ctx)
  }
  return { path, duration: await probeDuration(ctx, path), provider, warning }
}
