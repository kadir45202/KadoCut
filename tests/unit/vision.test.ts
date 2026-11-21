import { describe, expect, it } from 'vitest'
import { linkFaces, samplesToKeys } from '@renderer/modules/tracking/plan'

describe('face tracks', () => {
  it('links nearby boxes and separates distant faces', () => {
    const frames = [0, 1, 2, 3].map((i) => ({
      t: i / 6,
      faces: [
        { x: 0.1 + i * 0.01, y: 0.2, w: 0.1, h: 0.15 },
        { x: 0.7, y: 0.3, w: 0.08, h: 0.12 }
      ]
    }))
    const tracks = linkFaces(frames, 0.6)
    expect(tracks).toHaveLength(2)
    expect(tracks.map((t) => t.points.length)).toEqual([4, 4])
  })

  it('thins keyframes but keeps the last sample', () => {
    const keys = samplesToKeys(Array.from({ length: 31 }, (_, i) => ({ t: i / 30, v: i })), 0.25)
    expect(keys.length).toBe(5)
    expect(keys[keys.length - 1].v).toBe(30)
  })
})
