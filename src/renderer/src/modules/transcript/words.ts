import type { AudioClip, Project, VideoClip } from '@shared/project/schema'
import { clipEnd } from '@renderer/core/project/clip'
import { mainTrack } from '@renderer/core/project/timeline'
import { wordsOnTimeline } from '../captions/grouping'
import type { Removal } from '../silence/detect'

/** A transcript word placed on the timeline. */
export interface TranscriptWord {
  /** Stable within one render: `${clipId}:${index}`. */
  key: string
  clipId: string
  text: string
  start: number
  end: number
}

type SpeechClip = VideoClip | AudioClip

/** Main-track clips with transcribed audio, in timeline order. */
export function speechClips(p: Project): SpeechClip[] {
  const main = mainTrack(p).id
  return Object.values(p.clips)
    .filter((c): c is SpeechClip => (c.kind === 'video' || c.kind === 'audio') && c.trackId === main && !!p.assets[c.assetId]?.hasAudio)
    .sort((a, b) => a.start - b.start)
}

/** Every transcribed word on the main track, in timeline time. */
export function transcriptWords(p: Project): TranscriptWord[] {
  const out: TranscriptWord[] = []
  for (const clip of speechClips(p)) {
    const transcript = p.assets[clip.assetId]?.transcript
    if (!transcript) continue
    wordsOnTimeline(clip, transcript.words).forEach((w, i) => out.push({ key: `${clip.id}:${i}`, clipId: clip.id, ...w }))
  }
  return out
}

/** Hesitation sounds; `soft` adds filler words that are sometimes meaningful. */
const FILLERS = {
  tr: { hard: ['e', 'ee', 'eee', 'eeh', 'eh', 'ı', 'ıı', 'ııı', 'ım', 'ımm', 'hım', 'hmm', 'hm', 'mm', 'aa', 'ah', 'öö', 'ööö'], soft: ['yani', 'şey', 'işte', 'hani'] },
  en: { hard: ['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'hmm', 'hm', 'mm', 'ah', 'eh'], soft: ['like', 'basically', 'actually', 'literally'] }
}

const normalise = (text: string, locale: string) => text.toLocaleLowerCase(locale).replace(/[^\p{L}]+/gu, '')

export function isFiller(text: string, language: string, soft: boolean): boolean {
  const lang = language === 'en' ? 'en' : 'tr'
  const word = normalise(text, lang)
  if (!word) return false
  const set = FILLERS[lang]
  // Stretched hesitations ("eeeee", "ımmmm") count too.
  if (/^(e+h?|ı+m*|h?m+|a+h?|ö+|u+h*m*|e+r+m*)$/u.test(word)) return true
  return set.hard.includes(word) || (soft && set.soft.includes(word))
}

/**
 * Timeline ranges that remove the given words (a set of keys). Consecutive words merge into one
 * cut that also takes the pause after them, so the edit sounds natural.
 */
export function removalsFor(p: Project, words: TranscriptWord[], remove: ReadonlySet<string>): Removal[] {
  const byClip = new Map<string, [number, number][]>()
  for (let i = 0; i < words.length; i++) {
    if (!remove.has(words[i].key)) continue
    const first = words[i]
    while (i + 1 < words.length && remove.has(words[i + 1].key) && words[i + 1].clipId === first.clipId) i++
    const last = words[i]
    const clip = p.clips[first.clipId]
    if (!clip) continue
    const prev = words[words.indexOf(first) - 1]
    const next = words[i + 1]
    const lo = prev?.clipId === first.clipId ? prev.end : clip.start
    const hi = next?.clipId === first.clipId ? next.start : clipEnd(clip)
    const a = Math.max(lo, first.start - 0.03)
    const b = Math.min(hi - (next?.clipId === first.clipId ? 0.02 : 0), last.end + 0.3)
    if (b - a > 0.02) byClip.set(first.clipId, [...(byClip.get(first.clipId) ?? []), [a, b]])
  }
  return [...byClip].map(([clipId, ranges]) => ({ clipId, ranges }))
}

/** Prompt that makes Whisper keep hesitation sounds instead of cleaning them up. */
export const FILLER_PROMPT = {
  tr: 'Eee, şey, yani... Iıı, hmm, aslında ben, işte, böyle düşünüyorum.',
  en: 'Umm, uh, like, you know... Hmm, so, I mean, I was thinking.'
}
