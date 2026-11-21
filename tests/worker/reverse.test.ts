import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobContext } from '../../src/worker/context'
import { reverseVideo } from '../../src/worker/handlers/reverse'

const ffmpeg = join(__dirname, '..', '..', 'resources', 'bin', 'win', 'ffmpeg.exe')
const ffprobe = join(__dirname, '..', '..', 'resources', 'bin', 'win', 'ffprobe.exe')

/** Mean brightness of each frame (32×18 grey). */
function brightness(video: string): number[] {
  const raw = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', 'scale=32:18,format=gray', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 1 << 26 })
  const size = 32 * 18
  const out: number[] = []
  for (let f = 0; f + size <= raw.length; f += size) {
    let sum = 0
    for (let i = 0; i < size; i++) sum += raw[f + i]
    out.push(sum / size)
  }
  return out
}

describe('reverse (worker)', () => {
  it('plays a range backwards across chunk boundaries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maker-rev-'))
    const src = join(dir, 'ramp.mp4')
    // 12 s that brighten steadily (frame n → luma ≈ n * 0.7), with sound.
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', "color=c=black:size=320x180:rate=30:duration=12,geq=lum='clip(N*0.7,0,255)':cb=128:cr=128",
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12:sample_rate=48000',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src
    ])
    const ctx: JobContext = {
      env: { ffmpeg, ffprobe, cacheDir: dir, componentsDir: dir, projectMediaDir: dir, secrets: {}, elevenVoiceId: '' },
      signal: new AbortController().signal,
      progress: () => {},
      log: () => {}
    }
    // Seconds 1–10 (3 chunks of up to 4 s).
    const out = await reverseVideo({ projectId: 'p', path: src, start: 1, duration: 9, hasAudio: true }, ctx)
    const levels = brightness(out.path)
    expect(levels.length).toBeGreaterThan(260)
    expect(levels.length).toBeLessThan(280)
    // Starts where the range ends (~frame 299 → luma ~210) and darkens to its start (~frame 30 → ~21).
    expect(levels[0]).toBeGreaterThan(190)
    expect(levels.at(-1)!).toBeLessThan(40)
    for (let i = 10; i < levels.length; i += 10) expect(levels[i]).toBeLessThanOrEqual(levels[i - 10] + 2)
    const streams = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out.path]).toString()
    expect(streams).toContain('audio')
  }, 120000)
})
