import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, requireComponents, type JobContext } from '../context'

type Face = { x: number; y: number; w: number; h: number; score: number }

/** Streams raw frames of `bytes` each from ffmpeg; cancellable. */
async function* frames(ctx: JobContext, args: string[], bytes: number): AsyncGenerator<Buffer> {
  const proc = spawn(ctx.env.ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, 'pipe:1'], { windowsHide: true })
  const kill = () => proc.kill()
  ctx.signal.addEventListener('abort', kill)
  let stderr = ''
  proc.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-1000)))
  const closed = new Promise<number | null>((r) => proc.on('close', r))
  try {
    let pending: Buffer = Buffer.alloc(0)
    for await (const chunk of proc.stdout) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer)
      while (pending.length >= bytes) {
        if (ctx.signal.aborted) throw fail('cancelled', 'Cancelled')
        yield pending.subarray(0, bytes)
        pending = pending.subarray(bytes)
      }
    }
    const code = await closed
    if (ctx.signal.aborted) throw fail('cancelled', 'Cancelled')
    if (code !== 0) throw fail('failed', `ffmpeg exited with ${code}: ${stderr.trim()}`)
  } finally {
    ctx.signal.removeEventListener('abort', kill)
    proc.kill()
  }
}

const iou = (a: Face, b: Face) => {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
  return inter / (a.w * a.h + b.w * b.h - inter || 1)
}

// UltraFace RFB-320: 320×240 RGB input, scores and corner boxes (normalised) per prior.
const FW = 320
const FH = 240

/**
 * Face boxes over a source range, sampled at `fps`. Frames are letterboxed into the model's
 * 4:3 input and boxes are mapped back to fractions of the source frame.
 */
export async function detectFaces(input: JobInput<'video.detectFaces'>, ctx: JobContext): Promise<JobOutput<'video.detectFaces'>> {
  const [dir] = requireComponents(ctx, 'face-detector')
  const ort = await import('onnxruntime-node')
  const session = await ort.InferenceSession.create(join(dir, 'face.onnx'), { executionProviders: ['cpu'], logSeverityLevel: 3 })
  // Letterbox geometry: the source is scaled to fit and centred.
  const k = Math.min(FW / input.width, FH / input.height)
  const sw = input.width * k
  const sh = input.height * k
  const ox = (FW - sw) / 2
  const oy = (FH - sh) / 2
  const vf = `fps=${input.fps},scale=${Math.round(sw)}:${Math.round(sh)},pad=${FW}:${FH}:(ow-iw)/2:(oh-ih)/2`
  const args = ['-ss', input.start.toFixed(3), '-t', input.duration.toFixed(3), '-i', input.path, '-an', '-vf', vf, '-pix_fmt', 'rgb24', '-f', 'rawvideo']
  const tensor = new Float32Array(3 * FW * FH)
  const out: JobOutput<'video.detectFaces'>['frames'] = []
  const total = Math.max(1, Math.round(input.duration * input.fps))
  let index = 0
  for await (const frame of frames(ctx, args, FW * FH * 3)) {
    for (let i = 0; i < FW * FH; i++) {
      tensor[i] = (frame[i * 3] - 127) / 128
      tensor[FW * FH + i] = (frame[i * 3 + 1] - 127) / 128
      tensor[2 * FW * FH + i] = (frame[i * 3 + 2] - 127) / 128
    }
    const r = await session.run({ input: new ort.Tensor('float32', tensor, [1, 3, FH, FW]) })
    const scores = r.scores.data as Float32Array
    const boxes = r.boxes.data as Float32Array
    const found: Face[] = []
    for (let i = 0; i < scores.length / 2; i++) {
      const score = scores[i * 2 + 1]
      if (score < input.threshold) continue
      // Model space → source fractions.
      const x0 = (boxes[i * 4] * FW - ox) / sw
      const y0 = (boxes[i * 4 + 1] * FH - oy) / sh
      const x1 = (boxes[i * 4 + 2] * FW - ox) / sw
      const y1 = (boxes[i * 4 + 3] * FH - oy) / sh
      found.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, score })
    }
    // Non-maximum suppression.
    found.sort((a, b) => b.score - a.score)
    const faces: Face[] = []
    for (const f of found) if (f.w > 0 && f.h > 0 && faces.every((g) => iou(f, g) < 0.3)) faces.push(f)
    out.push({ t: input.start + index / input.fps, faces })
    index++
    if (index % 4 === 0) ctx.progress(Math.min(0.98, index / total), 'faces')
  }
  return { frames: out }
}

/**
 * Follows a square patch (centre x/y, side `size`, all fractions of the source width/height)
 * through the range with coarse-to-fine normalised cross-correlation on a grey proxy.
 */
export async function trackPoint(input: JobInput<'video.track'>, ctx: JobContext): Promise<JobOutput<'video.track'>> {
  const W = 480
  const H = Math.max(2, Math.round((W * input.height) / input.width / 2) * 2)
  const args = ['-ss', input.start.toFixed(3), '-t', input.duration.toFixed(3), '-i', input.path, '-an', '-vf', `fps=${input.fps},scale=${W}:${H}`, '-pix_fmt', 'gray', '-f', 'rawvideo']
  const half = Math.max(6, Math.round((input.size * W) / 2))
  const search = Math.round(half * 1.6)
  let cx = input.x * W
  let cy = input.y * H
  let template: Float32Array | null = null
  const points: JobOutput<'video.track'>['points'] = []
  const total = Math.max(1, Math.round(input.duration * input.fps))
  let index = 0
  let lost = 0

  const patch = (img: Buffer, x: number, y: number, step: number): Float32Array | null => {
    const n = Math.floor(half / step)
    const out = new Float32Array((2 * n + 1) ** 2)
    let k = 0
    for (let dy = -n; dy <= n; dy++) {
      for (let dx = -n; dx <= n; dx++) {
        const px = Math.round(x + dx * step)
        const py = Math.round(y + dy * step)
        if (px < 0 || py < 0 || px >= W || py >= H) return null
        out[k++] = img[py * W + px]
      }
    }
    return out
  }
  const ncc = (a: Float32Array, b: Float32Array) => {
    let ma = 0
    let mb = 0
    for (let i = 0; i < a.length; i++) {
      ma += a[i]
      mb += b[i]
    }
    ma /= a.length
    mb /= b.length
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma
      const y = b[i] - mb
      num += x * y
      da += x * x
      db += y * y
    }
    return num / (Math.sqrt(da * db) || 1)
  }
  const subsample = (t: Float32Array, step: number) => {
    // Template at a coarser step: every `step`-th sample of the full-resolution patch.
    const n = 2 * half + 1
    const m = Math.floor(half / step)
    const out = new Float32Array((2 * m + 1) ** 2)
    let k = 0
    for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) out[k++] = t[(half + dy * step) * n + (half + dx * step)]
    return out
  }

  for await (const img of frames(ctx, args, W * H)) {
    if (!template) {
      template = patch(img, cx, cy, 1)
      if (!template) throw fail('failed', 'The tracked area is too close to the frame edge')
    } else {
      // Coarse search every 3 px, then refine at 1 px around the best match.
      const coarse = subsample(template, 3)
      let best = -2
      let bx = cx
      let by = cy
      for (let dy = -search; dy <= search; dy += 3) {
        for (let dx = -search; dx <= search; dx += 3) {
          const p = patch(img, cx + dx, cy + dy, 3)
          if (!p) continue
          const score = ncc(coarse, p)
          if (score > best) {
            best = score
            bx = cx + dx
            by = cy + dy
          }
        }
      }
      const fx = bx
      const fy = by
      best = -2
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const p = patch(img, fx + dx, fy + dy, 1)
          if (!p) continue
          const score = ncc(template, p)
          if (score > best) {
            best = score
            bx = fx + dx
            by = fy + dy
          }
        }
      }
      if (best > 0.5) {
        cx = bx
        cy = by
        lost = 0
        // Slowly adapt to appearance changes (rotation, lighting).
        const current = patch(img, cx, cy, 1)
        if (current && best > 0.8) for (let i = 0; i < template.length; i++) template[i] = template[i] * 0.9 + current[i] * 0.1
      } else {
        lost++
      }
    }
    points.push({ t: input.start + index / input.fps, x: cx / W, y: cy / H, confident: lost === 0 })
    index++
    if (index % 5 === 0) ctx.progress(Math.min(0.98, index / total), 'track')
  }
  return { points }
}
