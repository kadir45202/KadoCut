import type { AudioClip, VideoClip } from '@shared/project/schema'
import { localTimeForSourceOffset, sourceSpan } from '@renderer/core/project/speed'

export interface TimedWord {
  text: string
  start: number
  end: number
}

export interface CaptionChunk {
  start: number
  end: number
  words: TimedWord[]
}

const MAX_GAP = 0.6
const MAX_CHUNK_SECONDS = 2.8
const MIN_CHUNK_SECONDS = 0.25
const BRIDGE_GAP = 0.35

/** Maps words in source-file time to timeline time through the clip's trim and speed. */
export function wordsOnTimeline(clip: VideoClip | AudioClip, words: TimedWord[]): TimedWord[] {
  const span = sourceSpan(clip.speed, clip.duration)
  const toTimeline = (src: number) => clip.start + localTimeForSourceOffset(clip.speed, clip.duration, Math.min(span, Math.max(0, src - clip.in)))
  return words
    .filter((w) => w.end > clip.in && w.start < clip.in + span)
    .map((w) => ({ text: w.text, start: toTimeline(w.start), end: toTimeline(w.end) }))
    .filter((w) => w.end > w.start)
}

/**
 * Splits words into short caption chunks: at most `maxWords`, broken at pauses, sentence ends
 * and when a chunk gets too long. Short gaps are bridged so captions don't flicker.
 */
export function groupWords(words: TimedWord[], maxWords: number): CaptionChunk[] {
  const chunks: CaptionChunk[] = []
  let current: TimedWord[] = []
  const flush = () => {
    if (current.length) chunks.push({ start: current[0].start, end: current[current.length - 1].end, words: current })
    current = []
  }
  for (const w of words) {
    const last = current[current.length - 1]
    if (
      last &&
      (current.length >= maxWords ||
        w.start - last.end > MAX_GAP ||
        w.end - current[0].start > MAX_CHUNK_SECONDS ||
        /[.!?…]$/.test(last.text) ||
        (/[,;:]$/.test(last.text) && current.length >= 2))
    ) {
      flush()
    }
    current.push(w)
  }
  flush()
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1]
    if (next && next.start - chunks[i].end < BRIDGE_GAP) chunks[i].end = next.start
    if (chunks[i].end - chunks[i].start < MIN_CHUNK_SECONDS) chunks[i].end = Math.min(chunks[i].start + MIN_CHUNK_SECONDS, next?.start ?? Infinity)
  }
  return chunks.filter((c) => c.end > c.start)
}
