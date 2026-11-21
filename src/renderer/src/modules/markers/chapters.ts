import type { Marker } from '@shared/project/schema'

/** YouTube needs at least 3 chapters, the first at 0:00, each at least 10 seconds long. */
export const MIN_CHAPTERS = 3
export const MIN_CHAPTER_SECONDS = 10

export interface Chapters {
  text: string
  count: number
  /** Some chapter is shorter than 10 s. */
  tooShort: boolean
  /** YouTube will turn the list into chapters. */
  ok: boolean
}

export function chapterStamp(t: number, withHours: boolean): string {
  const s = Math.max(0, Math.floor(t + 1e-6))
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  return withHours ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
}

/**
 * Chapter list for a YouTube description from timeline markers. A chapter at 0:00 is added
 * (named `intro`) when the first marker comes later; unnamed markers get `fallback(n)`.
 */
export function youtubeChapters(markers: Marker[], duration: number, intro: string, fallback: (n: number) => string): Chapters {
  const sorted = [...markers].filter((m) => m.t < duration).sort((a, b) => a.t - b.t)
  const items = sorted.map((m, i) => ({ t: m.t, label: m.label.trim() || fallback(i + 1) }))
  if (!items.length || items[0].t >= 1) items.unshift({ t: 0, label: intro })
  else items[0].t = 0
  const withHours = duration >= 3600
  let tooShort = false
  items.forEach((item, i) => {
    const end = i + 1 < items.length ? items[i + 1].t : duration
    if (end - item.t < MIN_CHAPTER_SECONDS) tooShort = true
  })
  return {
    text: items.map((i) => `${chapterStamp(i.t, withHours)} ${i.label}`).join('\n'),
    count: items.length,
    tooShort,
    ok: items.length >= MIN_CHAPTERS && !tooShort
  }
}
