import { cpus, tmpdir } from 'node:os'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { whisperComponent, type WhisperModel } from '@shared/components'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, ffmpeg, findFile, requireComponents, runProcess, type JobContext } from '../context'

const DTW_PRESET: Record<WhisperModel, string> = {
  base: 'base',
  small: 'small',
  'large-v3-turbo': 'large.v3.turbo'
}

interface WhisperToken {
  text: string
  offsets: { from: number; to: number }
  t_dtw?: number
}

interface WhisperJson {
  result?: { language?: string }
  transcription?: { tokens?: WhisperToken[] }[]
}

type Word = { text: string; start: number; end: number }

/**
 * Groups BPE tokens into words. Token text is kept as raw bytes (latin1) and decoded as UTF-8
 * only per word, because Turkish characters are often split across two tokens.
 */
export function tokensToWords(data: WhisperJson): Word[] {
  const words: { bytes: string; start: number; end: number }[] = []
  for (const segment of data.transcription ?? []) {
    for (const token of segment.tokens ?? []) {
      if (token.text.startsWith('[_') || token.text.startsWith('<|')) continue
      const start = token.t_dtw !== undefined && token.t_dtw >= 0 ? token.t_dtw / 100 : token.offsets.from / 1000
      const end = token.offsets.to / 1000
      const last = words.at(-1)
      if (!last || token.text.startsWith(' ')) {
        words.push({ bytes: token.text, start, end })
      } else {
        last.bytes += token.text
        last.end = Math.max(last.end, end)
      }
    }
  }
  const result: Word[] = []
  // Whisper writes sound annotations like "[Müzik]" or "(alkış)"; they are not speech.
  let annotation = false
  for (const w of words) {
    const text = Buffer.from(w.bytes, 'latin1').toString('utf8').trim()
    if (!text) continue
    if (/^[[(]/.test(text)) annotation = true
    const skip = annotation
    if (annotation && /[\])][.,!?]*$/.test(text)) annotation = false
    if (skip) continue
    result.push({ text, start: w.start, end: Math.max(w.end, w.start + 0.05) })
  }
  // Keep words monotonic and non-overlapping.
  for (let i = 0; i < result.length; i++) {
    if (i > 0 && result[i].start < result[i - 1].start) result[i].start = result[i - 1].start
    if (i < result.length - 1) result[i].end = Math.min(result[i].end, Math.max(result[i + 1].start, result[i].start + 0.05))
  }
  return result
}

export async function transcribe(input: JobInput<'captions.transcribe'>, ctx: JobContext): Promise<JobOutput<'captions.transcribe'>> {
  const [runtimeDir, modelDir] = requireComponents(ctx, 'whisper-runtime', whisperComponent(input.model))
  const exe = findFile(runtimeDir, 'whisper-cli.exe') ?? findFile(runtimeDir, 'main.exe')
  if (!exe) throw fail('missing-component', 'whisper-cli.exe not found', ['whisper-runtime'])

  const base = join(tmpdir(), `maker-whisper-${Date.now()}`)
  const wav = `${base}.wav`
  try {
    ctx.progress(0.02, 'prepare')
    await ffmpeg(ctx, [
      '-ss', input.start.toFixed(3), '-t', input.duration.toFixed(3),
      '-i', input.path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav
    ])
    const threads = Math.max(1, Math.min(8, cpus().length - 1))
    await runProcess(
      ctx,
      exe,
      [
        '-m', join(modelDir, 'model.bin'),
        '-f', wav,
        '-l', input.language,
        '-t', String(threads),
        '--dtw', DTW_PRESET[input.model],
        '-ojf', '-of', base,
        '-pp', '-np',
        ...(input.prompt ? ['--prompt', input.prompt] : [])
      ],
      {
        onStderr: (text) => {
          const m = /progress\s*=\s*(\d+)%/.exec(text)
          if (m) ctx.progress(0.05 + (Number(m[1]) / 100) * 0.9, 'transcribe')
        }
      }
    )
    const raw = await readFile(`${base}.json`)
    const data = JSON.parse(raw.toString('latin1')) as WhisperJson
    const words = tokensToWords(data).map((w) => ({ ...w, start: w.start + input.start, end: w.end + input.start }))
    return { language: data.result?.language ?? input.language, words }
  } finally {
    await unlink(wav).catch(() => {})
    await unlink(`${base}.json`).catch(() => {})
  }
}
