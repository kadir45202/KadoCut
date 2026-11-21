import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobContext } from '../../src/worker/context'
import { stabilize } from '../../src/worker/handlers/stabilize'

const ffmpeg = join(__dirname, '..', '..', 'resources', 'bin', 'win', 'ffmpeg.exe')

/** Mean absolute difference between consecutive 160×90 grey frames (0–255). */
function jitter(video: string): number {
  const raw = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', 'scale=160:90,format=gray', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 28 })
  const size = 160 * 90
  const frames = Math.floor(raw.length / size)
  let sum = 0
  for (let f = 1; f < frames; f++) {
    for (let i = 0; i < size; i++) sum += Math.abs(raw[f * size + i] - raw[(f - 1) * size + i])
  }
  return sum / ((frames - 1) * size)
}

describe('stabilization (worker)', () => {
  it('removes camera shake from a still scene', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maker-stab-'))
    const shaky = join(dir, 'shaky.mp4')
    // A static textured picture with hand-held style jitter of up to ±18 px.
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'mandelbrot=size=720x440:rate=30:end_pts=0.01',
      '-vf', "loop=loop=-1:size=1,trim=duration=4,crop=640:360:40+12*sin(n*1.3)+6*sin(n*3.1):40+10*cos(n*1.7),setpts=N/30/TB",
      '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', shaky
    ])
    const ctx: JobContext = {
      env: { ffmpeg, ffprobe: '', cacheDir: dir, componentsDir: dir, projectMediaDir: dir, secrets: {}, elevenVoiceId: '' },
      signal: new AbortController().signal,
      progress: () => {},
      log: () => {}
    }
    const out = await stabilize({ projectId: 'p', path: shaky, duration: 4, strength: 0.8 }, ctx)
    expect(existsSync(out.path)).toBe(true)
    const before = jitter(shaky)
    const after = jitter(out.path)
    // Typically drops from ~20 to well under half.
    expect(after).toBeLessThan(before * 0.5)
  }, 120000)
})
