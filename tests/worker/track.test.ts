import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { JobContext } from '../../src/worker/context'
import { trackPoint } from '../../src/worker/handlers/vision'

const ffmpeg = join(__dirname, '..', '..', 'resources', 'bin', 'win', 'ffmpeg.exe')

describe('motion tracking (worker)', () => {
  it('follows a moving square', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maker-track-'))
    const video = join(dir, 'moving.mp4')
    // A textured square sliding from x=100 to x=1000 over 3 s on a 1280×720 frame.
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=0x202020:size=1280x720:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'testsrc2=size=120x120:rate=30:duration=3',
      '-filter_complex', "[0][1]overlay=x='100+300*t':y=300", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ])
    const ctx: JobContext = {
      env: { ffmpeg, ffprobe: '', cacheDir: dir, componentsDir: dir, projectMediaDir: dir, secrets: {}, elevenVoiceId: '' },
      signal: new AbortController().signal,
      progress: () => {},
      log: () => {}
    }
    const out = await trackPoint({ path: video, start: 0, duration: 3, fps: 30, width: 1280, height: 720, x: 160 / 1280, y: 360 / 720, size: 0.06 }, ctx)
    expect(out.points.length).toBeGreaterThan(80)
    const last = out.points[out.points.length - 1]
    // Moved ~870 px to the right (0.68 of the width), stayed at the same height.
    expect(last.x - out.points[0].x).toBeGreaterThan(0.62)
    expect(last.x - out.points[0].x).toBeLessThan(0.74)
    expect(Math.abs(last.y - out.points[0].y)).toBeLessThan(0.02)
  }, 60000)
})
