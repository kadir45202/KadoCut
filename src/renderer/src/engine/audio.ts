import type { AudioClip, Project, VideoClip, VoiceFx } from '@shared/project/schema'
import { evalAnimated } from '@renderer/core/project/keyframes'
import { rateAt, sourceOffsetAt, sourceSpan } from '@renderer/core/project/speed'
import { mediaUrl } from '@renderer/lib/api'

export const SAMPLE_RATE = 48_000
const CURVE_RATE = 100 // automation samples per second

export type SoundClip = VideoClip | AudioClip

/** A decoded source for a clip; `stretchedRate` is set when the buffer is pre-stretched. */
export interface ResolvedAudio {
  buffer: AudioBuffer
  stretchedRate: number | null
}

export type AudioResolver = (clip: SoundClip) => ResolvedAudio | null

/** Media file whose audio a clip plays (denoised render when enabled and ready). */
export function audioPathFor(project: Project, clip: SoundClip): string | null {
  const asset = project.assets[clip.assetId]
  if (!asset?.hasAudio) return null
  if (clip.audio.denoise.enabled && clip.audio.denoise.assetId) {
    const dn = project.assets[clip.audio.denoise.assetId]
    if (dn) return dn.path
  }
  return asset.path
}

/** Constant-speed clips with pitch preservation play from a time-stretched render. */
export function needsStretch(clip: SoundClip): number | null {
  const s = clip.speed
  return s.mode === 'constant' && s.preservePitch && Math.abs(s.rate - 1) > 1e-3 ? s.rate : null
}

/** Clips that make sound: unmuted audio clips and video clips with (non-detached) audio. */
export function soundClips(project: Project): SoundClip[] {
  const muted = new Set(project.tracks.filter((t) => t.muted).map((t) => t.id))
  return Object.values(project.clips).filter((c): c is SoundClip => {
    if (c.kind !== 'video' && c.kind !== 'audio') return false
    if (muted.has(c.trackId) || c.audio.muted) return false
    if (c.kind === 'video' && (c.audio.detached || !project.assets[c.assetId]?.hasAudio)) return false
    return true
  })
}

/** Interleaved 48 kHz stereo float file → AudioBuffer (cached per path). */
const bufferCache = new Map<string, Promise<AudioBuffer>>()

export function loadPcm(path: string): Promise<AudioBuffer> {
  let p = bufferCache.get(path)
  if (!p) {
    p = fetch(mediaUrl(path))
      .then((r) => {
        if (!r.ok) throw new Error(`PCM ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        const data = new Float32Array(buf)
        const frames = Math.floor(data.length / 2)
        const audio = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, frames), sampleRate: SAMPLE_RATE })
        const l = audio.getChannelData(0)
        const r = audio.getChannelData(1)
        for (let i = 0; i < frames; i++) {
          l[i] = data[i * 2]
          r[i] = data[i * 2 + 1]
        }
        return audio
      })
    p.catch(() => bufferCache.delete(path))
    bufferCache.set(path, p)
  }
  return p
}

/** Synchronous lookup of an already-loaded buffer. */
const loaded = new Map<string, AudioBuffer>()
export function loadedPcm(path: string): AudioBuffer | undefined {
  return loaded.get(path)
}
export async function warmPcm(path: string): Promise<AudioBuffer> {
  const b = await loadPcm(path)
  loaded.set(path, b)
  return b
}

function gainAt(clip: SoundClip, local: number): number {
  const { fadeIn, fadeOut } = clip.audio
  let g = evalAnimated(clip.audio.volume, local)
  if (fadeIn > 0) g *= Math.min(1, local / fadeIn)
  if (fadeOut > 0) g *= Math.min(1, (clip.duration - local) / fadeOut)
  return Math.max(0, g)
}

// ---------------------------------------------------------------- auto-ducking

/** Envelope resolution (samples per second) for speech detection and ducking. */
export const DUCK_RATE = 50
const HOLD_SECONDS = 0.3
const ATTACK_SECONDS = 0.08
const RELEASE_SECONDS = 0.35

const rmsCache = new WeakMap<AudioBuffer, Float32Array>()

/** RMS of a buffer in 1/DUCK_RATE windows (both channels), cached. */
function rmsOf(buffer: AudioBuffer): Float32Array {
  let rms = rmsCache.get(buffer)
  if (rms) return rms
  const win = Math.round(buffer.sampleRate / DUCK_RATE)
  const n = Math.ceil(buffer.length / win)
  rms = new Float32Array(n)
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (const data of channels) {
      for (let j = i * win; j < Math.min(data.length, (i + 1) * win); j++) {
        sum += data[j] * data[j]
        count++
      }
    }
    rms[i] = count ? Math.sqrt(sum / count) : 0
  }
  rmsCache.set(buffer, rms)
  return rms
}

/**
 * Loudest "voice" level (linear RMS × clip gain) over the timeline, from every audible clip that
 * is not itself ducked.
 */
function speechLevels(voices: SoundClip[], resolve: AudioResolver, duration: number): Float32Array {
  const levels = new Float32Array(Math.ceil(duration * DUCK_RATE) + 1)
  for (const clip of voices) {
    const res = resolve(clip)
    if (!res) continue
    const rms = rmsOf(res.buffer)
    const i0 = Math.max(0, Math.floor(clip.start * DUCK_RATE))
    const i1 = Math.min(levels.length - 1, Math.ceil((clip.start + clip.duration) * DUCK_RATE))
    for (let i = i0; i <= i1; i++) {
      const local = i / DUCK_RATE - clip.start
      if (local < 0 || local > clip.duration) continue
      const src = clip.in + sourceOffsetAt(clip.speed, clip.duration, local)
      const bufferTime = res.stretchedRate ? src / res.stretchedRate : src
      const level = (rms[Math.floor(bufferTime * DUCK_RATE)] ?? 0) * gainAt(clip, local)
      if (level > levels[i]) levels[i] = level
    }
  }
  return levels
}

/**
 * 0..1 "speech present" envelope from voice levels: threshold set by sensitivity (0 → -20 dBFS,
 * 1 → -50 dBFS), held briefly between words, with smooth attack and release.
 */
export function duckEnvelope(levels: Float32Array, rate: number, sensitivity: number): Float32Array {
  const threshold = 10 ** ((-20 - 30 * sensitivity) / 20)
  const hold = Math.round(HOLD_SECONDS * rate)
  const attack = 1 - Math.exp(-1 / (ATTACK_SECONDS * rate))
  const release = 1 - Math.exp(-1 / (RELEASE_SECONDS * rate))
  const env = new Float32Array(levels.length)
  // Look ahead by the attack time so the music is already down when speech starts.
  const lead = Math.round(ATTACK_SECONDS * rate)
  let held = 0
  let y = 0
  for (let i = 0; i < levels.length; i++) {
    if ((levels[Math.min(levels.length - 1, i + lead)] ?? 0) > threshold) held = hold
    const target = held > 0 ? 1 : 0
    if (held > 0) held--
    y += (target - y) * (target > y ? attack : release)
    env[i] = y
  }
  return env
}

function curve(from: number, to: number, fn: (t: number) => number): Float32Array {
  const n = Math.max(2, Math.ceil((to - from) * CURVE_RATE) + 1)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = fn(from + ((to - from) * i) / (n - 1))
  return out
}

const isConstant = (values: Float32Array) => values.every((v) => Math.abs(v - values[0]) < 1e-4)

const irCache = new WeakMap<BaseAudioContext, AudioBuffer>()

/** Decaying stereo noise as a hall impulse response (seeded, so preview and export match). */
function hallImpulse(ctx: BaseAudioContext): AudioBuffer {
  let ir = irCache.get(ctx)
  if (ir) return ir
  const length = Math.round(ctx.sampleRate * 2.2)
  ir = ctx.createBuffer(2, length, ctx.sampleRate)
  let seed = 12345
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c)
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      data[i] = ((seed / 2 ** 32) * 2 - 1) * (1 - i / length) ** 3
    }
  }
  irCache.set(ctx, ir)
  return ir
}

function softClip(ctx: BaseAudioContext, drive: number): WaveShaperNode {
  const ws = ctx.createWaveShaper()
  const curve = new Float32Array(1024)
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive)
  }
  ws.curve = curve
  return ws
}

/** Voice changer in front of `next`. Oscillators it starts are stopped through `stops`. */
function voiceChain(ctx: BaseAudioContext, voice: Exclude<VoiceFx, 'none'>, next: AudioNode, stops: (() => void)[]): AudioNode {
  const filter = (type: BiquadFilterType, frequency: number, q = 0.7, gain = 0) => {
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = frequency
    f.Q.value = q
    f.gain.value = gain
    return f
  }
  const amp = (value: number) => {
    const g = ctx.createGain()
    g.gain.value = value
    return g
  }
  const series = (...nodes: AudioNode[]) => {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    nodes[nodes.length - 1].connect(next)
    return nodes[0]
  }
  switch (voice) {
    case 'telephone':
      return series(filter('highpass', 400), filter('lowpass', 3000), softClip(ctx, 2), amp(0.9))
    case 'radio':
      return series(filter('highpass', 300), filter('peaking', 1500, 1, 6), filter('lowpass', 4500), softClip(ctx, 3), amp(0.8))
    case 'megaphone':
      return series(filter('highpass', 600), filter('peaking', 1800, 1.2, 9), filter('lowpass', 3800), softClip(ctx, 6), amp(0.6))
    case 'underwater':
      return series(filter('lowpass', 450, 1.5), amp(1.3))
    case 'echo': {
      const input = amp(1)
      input.connect(next)
      const delay = ctx.createDelay(1)
      delay.delayTime.value = 0.28
      const feedback = amp(0.38)
      input.connect(delay)
      delay.connect(feedback).connect(delay)
      delay.connect(amp(0.5)).connect(next)
      return input
    }
    case 'hall': {
      const input = amp(1)
      input.connect(amp(0.8)).connect(next)
      const conv = ctx.createConvolver()
      conv.buffer = hallImpulse(ctx)
      input.connect(conv).connect(amp(0.45)).connect(next)
      return input
    }
    case 'robot': {
      // Ring modulation at 50 Hz plus a short metallic comb.
      const ring = ctx.createGain()
      ring.gain.value = 0
      const osc = ctx.createOscillator()
      osc.frequency.value = 50
      osc.connect(ring.gain)
      osc.start()
      stops.push(() => osc.stop())
      const out = amp(1.4)
      ring.connect(out).connect(next)
      const comb = ctx.createDelay(0.05)
      comb.delayTime.value = 0.006
      ring.connect(comb)
      comb.connect(amp(0.45)).connect(comb)
      comb.connect(amp(0.6)).connect(next)
      return ring
    }
  }
}

/** Per-clip voice changer, EQ and compressor in front of `destination` (shared by preview and export). */
function effectsChain(ctx: BaseAudioContext, clip: SoundClip, destination: AudioNode, stops: (() => void)[]): AudioNode {
  let next = destination
  const { eq, compressor } = clip.audio
  if (compressor.enabled) {
    const makeup = ctx.createGain()
    makeup.gain.value = 10 ** (compressor.makeup / 20)
    makeup.connect(next)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = compressor.threshold
    comp.ratio.value = compressor.ratio
    comp.knee.value = 6
    comp.attack.value = 0.01
    comp.release.value = 0.2
    comp.connect(makeup)
    next = comp
  }
  if (eq.enabled) {
    const bands: [BiquadFilterType, number, number][] = [
      ['highshelf', 6000, eq.high],
      ['peaking', 1000, eq.mid],
      ['lowshelf', 120, eq.low]
    ]
    for (const [type, frequency, gainDb] of bands) {
      if (!gainDb) continue
      const f = ctx.createBiquadFilter()
      f.type = type
      f.frequency.value = frequency
      f.gain.value = gainDb
      if (type === 'peaking') f.Q.value = 0.9
      f.connect(next)
      next = f
    }
  }
  if (clip.audio.voice !== 'none') next = voiceChain(ctx, clip.audio.voice, next, stops)
  return next
}

/**
 * Schedules every audible clip from timeline time `from`, starting at context time `when`.
 * Used by the realtime preview and by the offline export render alike.
 */
export function scheduleAudio(
  ctx: BaseAudioContext,
  destination: AudioNode,
  project: Project,
  from: number,
  when: number,
  resolve: AudioResolver
): AudioBufferSourceNode[] {
  const nodes: AudioBufferSourceNode[] = []
  const sounds = soundClips(project)
  const ducked = sounds.filter((c) => c.audio.ducking.enabled)
  const duration = sounds.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
  const levels = ducked.length ? speechLevels(sounds.filter((c) => !c.audio.ducking.enabled), resolve, duration) : null
  for (const clip of sounds) {
    const end = clip.start + clip.duration
    if (end <= from + 1e-4) continue
    const res = resolve(clip)
    if (!res) continue
    const local0 = Math.max(0, from - clip.start)
    const remaining = clip.duration - local0
    if (remaining <= 1e-4) continue
    const startAt = when + Math.max(0, clip.start - from)

    const src = ctx.createBufferSource()
    src.buffer = res.buffer
    let offset: number
    let bufferDuration: number
    if (res.stretchedRate) {
      offset = (clip.in + sourceOffsetAt(clip.speed, clip.duration, local0)) / res.stretchedRate
      bufferDuration = remaining
    } else if (clip.speed.mode === 'constant') {
      src.playbackRate.value = clip.speed.rate
      offset = clip.in + local0 * clip.speed.rate
      bufferDuration = remaining * clip.speed.rate
    } else {
      const rates = curve(local0, clip.duration, (t) => rateAt(clip.speed, clip.duration, t))
      src.playbackRate.setValueCurveAtTime(rates, startAt, remaining)
      offset = clip.in + sourceOffsetAt(clip.speed, clip.duration, local0)
      bufferDuration = sourceSpan(clip.speed, clip.duration) - sourceOffsetAt(clip.speed, clip.duration, local0)
    }
    if (offset >= res.buffer.duration) continue

    const gain = ctx.createGain()
    let duck: ((t: number) => number) | null = null
    if (levels && clip.audio.ducking.enabled) {
      const env = duckEnvelope(levels, DUCK_RATE, clip.audio.ducking.sensitivity)
      const floor = 10 ** (clip.audio.ducking.amount / 20)
      duck = (local) => 1 - (env[Math.round((clip.start + local) * DUCK_RATE)] ?? 0) * (1 - floor)
    }
    const gains = curve(local0, clip.duration, (t) => gainAt(clip, t) * (duck ? duck(t) : 1))
    if (isConstant(gains)) gain.gain.value = gains[0]
    else {
      gain.gain.setValueCurveAtTime(gains, startAt, remaining)
    }
    const stops: (() => void)[] = []
    src.connect(gain).connect(effectsChain(ctx, clip, destination, stops))
    if (stops.length) src.onended = () => stops.forEach((stop) => stop())
    src.start(startAt, Math.max(0, offset), Math.max(0.001, bufferDuration))
    nodes.push(src)
  }
  return nodes
}
