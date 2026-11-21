import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobContext } from '../../src/worker/context'
import { highlightsLocal, translate } from '../../src/worker/handlers/ai'

const words = (text: string, start: number, rate = 3) =>
  text.split(' ').map((w, i) => ({ text: w, start: start + i / rate, end: start + (i + 0.8) / rate }))

describe('highlights (local scoring)', () => {
  it('prefers lively stretches and never overlaps', () => {
    const calm = words('bu bölüm çok yavaş ve sakin anlatılıyor.', 0, 1)
    const lively = words('Bunu biliyor muydunuz? İnanılmaz bir şey! Hemen deneyin, sonuç şaşırtıcı!', 40, 4)
    const clips = highlightsLocal({ words: [...calm, ...lively], count: 2, minLength: 2, maxLength: 20, language: 'tr' })
    expect(clips[0].start).toBeGreaterThanOrEqual(40)
    for (let i = 1; i < clips.length; i++) expect(clips[i].start >= clips[0].end || clips[i].end <= clips[0].start).toBe(true)
  })
})

// Runs llama.cpp for real when MAKER_TEST_LLM points at a components folder with
// llm-runtime + llm-gemma installed (any small GGUF works; quality is not checked).
const components = process.env.MAKER_TEST_LLM
describe.runIf(components && existsSync(components))('translate (local llama.cpp)', () => {
  it('returns one translated line per caption line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maker-llm-'))
    const ctx: JobContext = {
      env: { ffmpeg: '', ffprobe: '', cacheDir: dir, componentsDir: components!, projectMediaDir: dir, secrets: {}, elevenVoiceId: '' },
      signal: new AbortController().signal,
      progress: () => {},
      log: () => {}
    }
    const out = await translate({ lines: ['Merhaba dünya', 'Bugün hava çok güzel', 'Görüşürüz'], target: 'en' }, ctx)
    expect(out.provider).toBe('local')
    expect(out.lines).toHaveLength(3)
    expect(out.lines.every((l) => l.length > 0)).toBe(true)
  }, 120000)
})
