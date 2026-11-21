import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { z } from 'zod'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, findFile, requireComponents, type JobContext } from '../context'

const MODEL = 'claude-opus-5-5'

const LANGUAGE_NAMES: Record<string, string> = { tr: 'Turkish', en: 'English', de: 'German', fr: 'French', es: 'Spanish', ar: 'Arabic', ru: 'Russian' }

/**
 * One structured request to Claude. Server-side fallbacks re-run a request that is declined
 * for policy reasons on Anthropic's recommended substitute model.
 */
async function askClaude<T extends z.ZodType>(ctx: JobContext, key: string, system: string, prompt: string, schema: T): Promise<z.infer<T>> {
  const client = new Anthropic({ apiKey: key })
  const response = await client.beta.messages.parse(
    {
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: 'user', content: prompt }]
    },
    { signal: ctx.signal }
  )
  if (response.stop_reason === 'refusal') throw fail('provider', `Claude declined the request (${response.stop_details?.category ?? 'policy'})`)
  if (response.stop_reason === 'max_tokens') throw fail('provider', 'Claude response was cut off')
  if (!response.parsed_output) throw fail('provider', 'Claude returned an unexpected answer')
  return response.parsed_output
}

const Translation = z.object({ lines: z.array(z.string()) })

async function translateClaude(input: JobInput<'ai.translate'>, ctx: JobContext, key: string): Promise<string[]> {
  const out = await askClaude(
    ctx,
    key,
    'You translate short video caption lines. Keep each line short and natural for on-screen captions, keep the meaning and tone, and never merge or split lines.',
    `Translate these ${input.lines.length} caption lines into ${LANGUAGE_NAMES[input.target] ?? input.target}. Return exactly ${input.lines.length} lines in the same order.\n\n${JSON.stringify(input.lines)}`,
    Translation
  )
  if (out.lines.length !== input.lines.length) throw fail('provider', 'Claude returned a different number of lines')
  return out.lines
}

// ---------------------------------------------------------------- local LLM (llama.cpp)

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })

/** Starts llama-server on a free local port; resolves once the model is loaded. */
async function startLlama(ctx: JobContext): Promise<{ url: string; stop(): void }> {
  const [runtimeDir, modelDir] = requireComponents(ctx, 'llm-runtime', 'llm-gemma')
  const exe = findFile(runtimeDir, 'llama-server.exe')
  if (!exe) throw fail('missing-component', 'llama-server.exe not found', ['llm-runtime'])
  const port = await freePort()
  const proc = spawn(exe, ['-m', join(modelDir, 'model.gguf'), '--host', '127.0.0.1', '--port', String(port), '-c', '8192', '--no-webui'], { windowsHide: true })
  const stop = () => proc.kill()
  ctx.signal.addEventListener('abort', stop)
  let exited = false
  proc.on('close', () => (exited = true))
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 600; i++) {
    if (ctx.signal.aborted) throw fail('cancelled', 'Cancelled')
    if (exited) throw fail('failed', 'The local language model stopped while loading')
    try {
      if ((await fetch(`${url}/health`)).ok) return { url, stop }
    } catch {
      // still starting
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  stop()
  throw fail('timeout', 'The local language model did not start')
}

async function translateLocal(input: JobInput<'ai.translate'>, ctx: JobContext): Promise<string[]> {
  const server = await startLlama(ctx)
  try {
    const out: string[] = []
    const BATCH = 20
    for (let i = 0; i < input.lines.length; i += BATCH) {
      const batch = input.lines.slice(i, i + BATCH)
      const res = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctx.signal,
        body: JSON.stringify({
          temperature: 0.2,
          messages: [
            {
              role: 'user',
              content: `Translate each caption line into ${LANGUAGE_NAMES[input.target] ?? input.target}. Answer with JSON {"lines": [...]} containing exactly ${batch.length} translated lines in the same order.\n\n${JSON.stringify(batch)}`
            }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'translation', schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' }, minItems: batch.length, maxItems: batch.length } }, required: ['lines'] } }
          }
        })
      })
      if (!res.ok) throw fail('failed', `Local model error ${res.status}: ${(await res.text()).slice(0, 200)}`)
      const body = (await res.json()) as { choices: { message: { content: string } }[] }
      const lines = Translation.parse(JSON.parse(body.choices[0].message.content)).lines
      out.push(...batch.map((line, k) => lines[k]?.trim() || line))
      ctx.progress(Math.min(0.98, (i + batch.length) / input.lines.length), 'translate')
    }
    return out
  } finally {
    server.stop()
  }
}

export async function translate(input: JobInput<'ai.translate'>, ctx: JobContext): Promise<JobOutput<'ai.translate'>> {
  const key = ctx.env.secrets.anthropic
  if (key) {
    try {
      ctx.progress(0.1, 'claude')
      return { lines: await translateClaude(input, ctx, key), provider: 'claude' }
    } catch (err) {
      if (ctx.signal.aborted) throw err
      const warning = err instanceof Error ? err.message : String(err)
      ctx.log(`Claude failed, using local model: ${warning}`)
      return { lines: await translateLocal(input, ctx), provider: 'local', warning }
    }
  }
  return { lines: await translateLocal(input, ctx), provider: 'local' }
}

// ---------------------------------------------------------------- highlights

const Highlights = z.object({
  clips: z.array(z.object({ start: z.number(), end: z.number(), title: z.string(), reason: z.string() }))
})

type Word = JobInput<'ai.highlights'>['words'][number]

/** Transcript as timestamped sentences, the form Claude reads best. */
function sentences(words: Word[]): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = []
  let current: Word[] = []
  for (const w of words) {
    const last = current[current.length - 1]
    if (last && (w.start - last.end > 1.2 || /[.!?…]$/.test(last.text) || current.length > 40)) {
      out.push({ start: current[0].start, end: last.end, text: current.map((x) => x.text).join(' ') })
      current = []
    }
    current.push(w)
  }
  if (current.length) out.push({ start: current[0].start, end: current[current.length - 1].end, text: current.map((x) => x.text).join(' ') })
  return out
}

async function highlightsClaude(input: JobInput<'ai.highlights'>, ctx: JobContext, key: string) {
  const lines = sentences(input.words).map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
  const out = await askClaude(
    ctx,
    key,
    'You are a short-form video editor. You pick the moments of a long video that work best as standalone Reels / Shorts: a strong hook in the first seconds, one complete idea, and a satisfying ending.',
    `Video transcript with times in seconds:\n\n${lines.join('\n')}\n\nPick up to ${input.count} non-overlapping clips, each ${input.minLength}-${input.maxLength} seconds long. Start and end on sentence boundaries from the transcript times. Give each a short catchy title and a one-sentence reason, both in ${LANGUAGE_NAMES[input.language] ?? 'the transcript language'}. Order by how strong the clip is.`,
    Highlights
  )
  return out.clips
}

/**
 * Local fallback without a language model: scores windows of speech by how dense and lively
 * the talking is (words per second, questions / exclamations) and keeps the best ones.
 */
export function highlightsLocal(input: JobInput<'ai.highlights'>): JobOutput<'ai.highlights'>['clips'] {
  const list = sentences(input.words)
  const candidates: { start: number; end: number; score: number; text: string }[] = []
  for (let i = 0; i < list.length; i++) {
    let j = i
    while (j + 1 < list.length && list[j + 1].end - list[i].start <= input.maxLength) j++
    const start = list[i].start
    const end = list[j].end
    if (end - start < input.minLength) continue
    const text = list.slice(i, j + 1).map((s) => s.text).join(' ')
    const words = text.split(/\s+/).length
    const lively = (text.match(/[!?]/g) ?? []).length
    candidates.push({ start, end, text, score: words / (end - start) + lively * 0.3 })
  }
  candidates.sort((a, b) => b.score - a.score)
  const picked: typeof candidates = []
  for (const c of candidates) {
    if (picked.length >= input.count) break
    if (picked.every((p) => c.end <= p.start || c.start >= p.end)) picked.push(c)
  }
  return picked.map((c) => ({ start: c.start, end: c.end, title: c.text.split(/\s+/).slice(0, 6).join(' '), reason: '' }))
}

export async function highlights(input: JobInput<'ai.highlights'>, ctx: JobContext): Promise<JobOutput<'ai.highlights'>> {
  const key = ctx.env.secrets.anthropic
  if (key) {
    try {
      ctx.progress(0.1, 'claude')
      const clips = (await highlightsClaude(input, ctx, key)).filter((c) => c.end > c.start)
      return { clips, provider: 'claude' }
    } catch (err) {
      if (ctx.signal.aborted) throw err
      const warning = err instanceof Error ? err.message : String(err)
      ctx.log(`Claude failed, using local scoring: ${warning}`)
      return { clips: highlightsLocal(input), provider: 'local', warning }
    }
  }
  return { clips: highlightsLocal(input), provider: 'local' }
}
