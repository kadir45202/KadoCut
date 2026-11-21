import { describe, expect, it } from 'vitest'
import type { Asset, VideoClip } from '@shared/project/schema'
import { clipFromAsset } from '@renderer/core/project/factory'
import { withSpeed } from '@renderer/core/project/clip'
import { groupWords, wordsOnTimeline } from '@renderer/modules/captions/grouping'

const w = (text: string, start: number, end: number) => ({ text, start, end })

describe('caption grouping', () => {
  it('respects the word limit', () => {
    const words = ['bir', 'iki', 'üç', 'dört', 'beş'].map((t, i) => w(t, i * 0.3, i * 0.3 + 0.25))
    const chunks = groupWords(words, 2)
    expect(chunks.map((c) => c.words.map((x) => x.text).join(' '))).toEqual(['bir iki', 'üç dört', 'beş'])
  })

  it('breaks at sentence ends and pauses', () => {
    const chunks = groupWords([w('Merhaba.', 0, 0.4), w('Nasılsın', 0.5, 0.9), w('bugün', 2.0, 2.3)], 5)
    expect(chunks).toHaveLength(3)
  })

  it('bridges tiny gaps so captions do not flicker', () => {
    const chunks = groupWords([w('a', 0, 0.3), w('b', 0.32, 0.6), w('c', 0.7, 1.0)], 1)
    expect(chunks[0].end).toBeCloseTo(chunks[1].start)
  })

  it('maps source time through trim and speed', () => {
    const asset: Asset = { id: 'a', kind: 'video', name: 'v', path: 'v', duration: 20, width: 10, height: 10, fps: 30, hasAudio: true, hasVideo: true, hidden: false, derived: null, beats: [], transcript: null }
    const base = { ...(clipFromAsset(asset, 'main', 0) as VideoClip), start: 10, in: 4, duration: 6 }
    const fast = withSpeed(base, { mode: 'constant', rate: 2, preservePitch: true })
    // Source 6s is 2s into the source range → 1s on the timeline at 2x.
    const [word] = wordsOnTimeline(fast, [w('x', 6, 7)])
    expect(word.start).toBeCloseTo(11)
    expect(word.end).toBeCloseTo(11.5)
    expect(wordsOnTimeline(fast, [w('before', 1, 2)])).toHaveLength(0)
  })
})
