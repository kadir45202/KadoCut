import { contextBridge, ipcRenderer } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DecoderSpec, ExportBridge, ExportSession } from '@shared/api'

let session: ExportSession | null = null
const tempFiles: string[] = []

function track(proc: ChildProcess) {
  if (proc.pid) ipcRenderer.send('export:pid', proc.pid)
}

function stderrTail(proc: ChildProcess) {
  let tail = ''
  proc.stderr?.on('data', (d: Buffer) => {
    tail = (tail + d.toString()).slice(-2000)
  })
  return () => tail.trim()
}

/** Pull-based reader so ffmpeg is paused (back-pressure) while the compositor is busy. */
class FrameReader {
  private iterator: AsyncIterator<Buffer>
  private pending: Buffer[] = []
  private pendingBytes = 0
  private index = -1
  private last: Buffer | null = null
  private ended = false
  readonly frameSize: number

  constructor(
    readonly proc: ChildProcess,
    spec: DecoderSpec
  ) {
    this.frameSize = spec.width * spec.height * 4
    this.iterator = proc.stdout![Symbol.asyncIterator]()
  }

  private async nextFrame(): Promise<Buffer | null> {
    while (this.pendingBytes < this.frameSize) {
      const r = await this.iterator.next()
      if (r.done) return null
      this.pending.push(r.value as Buffer)
      this.pendingBytes += (r.value as Buffer).length
    }
    const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending)
    const frame = Buffer.from(all.subarray(0, this.frameSize))
    const rest = all.subarray(this.frameSize)
    this.pending = rest.length ? [rest] : []
    this.pendingBytes = rest.length
    return frame
  }

  async read(index: number): Promise<Buffer | null> {
    while (this.index < index && !this.ended) {
      const frame = await this.nextFrame()
      if (!frame) {
        this.ended = true
        break
      }
      this.last = frame
      this.index++
    }
    // Past the end of the source: hold the last decoded frame.
    return this.last
  }
}

const decoders = new Map<number, FrameReader>()
let nextDecoderId = 1
let encoder: { proc: ChildProcess; tail: () => string; exit: Promise<number | null> } | null = null

function rateArgs(name: string, mbps: number): string[] {
  const b = `${mbps}M`
  const max = `${Math.round(mbps * 1.5)}M`
  const buf = `${mbps * 2}M`
  if (name.endsWith('_nvenc')) return ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf]
  if (name.endsWith('_amf')) return ['-quality', 'quality', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max]
  if (name.endsWith('_qsv')) return ['-preset', 'medium', '-b:v', b, '-maxrate', max]
  return ['-preset', 'medium', '-b:v', b, '-maxrate', max, '-bufsize', buf]
}

function wav(channels: Float32Array[], sampleRate: number): Buffer {
  const frames = channels[0]?.length ?? 0
  const n = channels.length
  const data = Buffer.alloc(frames * n * 4)
  for (let i = 0; i < frames; i++) for (let c = 0; c < n; c++) data.writeFloatLE(channels[c][i], (i * n + c) * 4)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(3, 20) // IEEE float
  header.writeUInt16LE(n, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * n * 4, 28)
  header.writeUInt16LE(n * 4, 32)
  header.writeUInt16LE(32, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const bridge: ExportBridge = {
  async session() {
    session = (await ipcRenderer.invoke('export:session')) as ExportSession
    return session
  },

  async openDecoder(spec) {
    if (!session) throw new Error('No session')
    const args = ['-hide_banner', '-loglevel', 'error']
    // The native VP9 decoder drops alpha; libvpx keeps it.
    if (spec.alpha) args.push('-c:v', 'libvpx-vp9')
    args.push(
      '-ss', spec.start.toFixed(6),
      '-i', spec.path,
      '-an',
      '-vf', `fps=${spec.fps},scale=${spec.width}:${spec.height}:flags=bicubic,format=rgba`,
      '-f', 'rawvideo',
      'pipe:1'
    )
    const proc = spawn(session.ffmpeg, args, { windowsHide: true })
    track(proc)
    stderrTail(proc)
    const id = nextDecoderId++
    decoders.set(id, new FrameReader(proc, spec))
    return id
  },

  async readFrame(id, index) {
    const reader = decoders.get(id)
    if (!reader) throw new Error(`Unknown decoder ${id}`)
    const frame = await reader.read(index)
    return frame ? new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength) : null
  },

  async closeDecoder(id) {
    const reader = decoders.get(id)
    decoders.delete(id)
    reader?.proc.kill()
  },

  async writeAudio(channels, sampleRate) {
    const path = join(tmpdir(), `maker-export-${Date.now()}.wav`)
    await writeFile(path, wav(channels, sampleRate))
    tempFiles.push(path)
    return path
  },

  async openEncoder(audioPath) {
    if (!session) throw new Error('No session')
    const { request, encoder: name } = session
    const raw = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${request.width}x${request.height}`, '-r', String(request.fps), '-i', 'pipe:0']
    const ext = request.outputPath.toLowerCase().split('.').pop()
    const formatArgs: Record<Exclude<typeof request.format, 'mp4'>, string[]> = {
      // Per-frame palettes keep memory flat however long the GIF is.
      gif: [...raw, '-filter_complex', '[0:v]vflip,split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1:dither=bayer:bayer_scale=3', '-loop', '0', request.outputPath],
      png: [...raw, '-vf', 'vflip', '-frames:v', '1', request.outputPath],
      audio: [
        '-i', audioPath,
        ...(ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'aac', '-b:a', '256k']),
        '-ar', '48000',
        request.outputPath
      ]
    }
    const args = request.format !== 'mp4' ? ['-hide_banner', '-loglevel', 'error', '-y', ...formatArgs[request.format]] : [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${request.width}x${request.height}`, '-r', String(request.fps), '-i', 'pipe:0',
      '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      // WebGL readPixels is bottom-up; convert with the BT.709 matrix players expect.
      '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', name, ...rateArgs(name, request.bitrate),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      ...(request.codec === 'hevc' ? ['-tag:v', 'hvc1'] : ['-profile:v', 'high']),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-movflags', '+faststart',
      request.outputPath
    ]
    const proc = spawn(session.ffmpeg, args, { windowsHide: true })
    track(proc)
    const tail = stderrTail(proc)
    const exit = new Promise<number | null>((resolve) => proc.on('close', resolve))
    proc.stdin?.on('error', () => {}) // surfaced through the exit code instead
    encoder = { proc, tail, exit }
  },

  async writeFrame(rgba) {
    const stdin = encoder?.proc.stdin
    if (!stdin || stdin.destroyed) throw new Error(`Encoder stopped: ${encoder?.tail() ?? ''}`)
    if (!stdin.write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength))) {
      await new Promise<void>((resolve, reject) => {
        stdin.once('drain', resolve)
        encoder!.proc.once('close', () => reject(new Error(`Encoder stopped: ${encoder?.tail() ?? ''}`)))
      })
    }
  },

  async finishEncoder() {
    if (!encoder) throw new Error('No encoder')
    encoder.proc.stdin?.end()
    const code = await encoder.exit
    for (const f of tempFiles.splice(0)) await unlink(f).catch(() => {})
    if (code !== 0) throw new Error(`Encoder failed (${code}): ${encoder.tail()}`)
  },

  progress: (p, msg) => ipcRenderer.send('export:progress', p, msg),
  done: (output) => ipcRenderer.send('export:done', output),
  fail: (message) => ipcRenderer.send('export:fail', message),
  onCancel: (listener) => {
    ipcRenderer.on('export:cancel', () => listener())
  }
}

contextBridge.exposeInMainWorld('makerExport', bridge)
