import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { JobInput, JobOutput } from '@shared/jobs'
import { ffmpeg, projectFile, type JobContext } from '../context'

/** A path as a quoted filter option value (Windows drive colons and quotes escaped). */
const filterPath = (p: string) => `'${p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''")}'`

/**
 * vid.stab in two passes: motion analysis, then smoothing with an adaptive zoom that hides the
 * moving borders. Strength maps to the smoothing window (10–60 frames).
 */
export async function stabilize(input: JobInput<'video.stabilize'>, ctx: JobContext): Promise<JobOutput<'video.stabilize'>> {
  const out = projectFile(ctx, 'stabilized', 'mp4')
  const transforms = join(ctx.env.cacheDir, `stab-${Date.now().toString(36)}.trf`)
  const duration = Math.max(0.1, input.duration)
  const smoothing = Math.round(10 + Math.min(1, Math.max(0, input.strength)) * 50)
  // Progress of each pass maps onto its share of the job.
  const pass = (from: number, span: number): JobContext => ({ ...ctx, progress: (p, m) => ctx.progress(from + p * span, m) })
  try {
    await ffmpeg(pass(0, 0.4), ['-i', input.path, '-an', '-vf', `vidstabdetect=shakiness=8:accuracy=15:result=${filterPath(transforms)}`, '-f', 'null', '-'], { duration })
    await ffmpeg(
      pass(0.4, 0.6),
      [
        '-i', input.path,
        '-vf', `vidstabtransform=input=${filterPath(transforms)}:smoothing=${smoothing}:optzoom=1:zoomspeed=0.25:interpol=bicubic,unsharp=5:5:0.5:3:3:0.2`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p',
        // The clip keeps playing its sound from the original file.
        '-an',
        '-movflags', '+faststart',
        out
      ],
      { duration }
    )
  } finally {
    await rm(transforms, { force: true })
  }
  return { path: out }
}
