import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobInput, JobOutput } from '@shared/jobs'
import { ffmpeg, projectFile, type JobContext } from '../context'

/** FFmpeg's reverse filter holds every frame in memory, so long sources go in short chunks. */
const CHUNK_SECONDS = 4

/**
 * Plays a source range backwards (picture and sound): each chunk is reversed on its own and the
 * chunks are joined last-to-first without re-encoding.
 */
export async function reverseVideo(input: JobInput<'video.reverse'>, ctx: JobContext): Promise<JobOutput<'video.reverse'>> {
  const out = projectFile(ctx, 'reversed', 'mp4')
  const stamp = Date.now().toString(36)
  const end = input.start + input.duration
  const count = Math.max(1, Math.ceil(input.duration / CHUNK_SECONDS - 1e-6))
  const parts: string[] = []
  const list = join(ctx.env.cacheDir, `reverse-${stamp}.txt`)
  try {
    for (let i = 0; i < count; i++) {
      const from = input.start + i * CHUNK_SECONDS
      const length = Math.min(CHUNK_SECONDS, end - from)
      if (length <= 0.01) break
      const part = join(ctx.env.cacheDir, `reverse-${stamp}-${i}.mp4`)
      const sub: JobContext = { ...ctx, progress: (p, m) => ctx.progress((i + p) / count * 0.95, m) }
      await ffmpeg(
        sub,
        [
          '-ss', from.toFixed(3), '-t', length.toFixed(3), '-i', input.path,
          '-vf', 'reverse',
          ...(input.hasAudio ? ['-af', 'areverse', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000'] : ['-an']),
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
          part
        ],
        { duration: length }
      )
      parts.unshift(part)
    }
    await writeFile(list, parts.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
    await ffmpeg(ctx, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out])
  } finally {
    await Promise.all([list, ...parts].map((p) => rm(p, { force: true })))
  }
  return { path: out }
}
