/**
 * Beat tracking: spectral-flux onset envelope → tempo from autocorrelation → dynamic-programming
 * beat placement (after D. Ellis, "Beat Tracking by Dynamic Programming", 2007).
 */

const TARGET_RATE = 12_000
const WINDOW = 512
const HOP = 128

/** In-place radix-2 FFT of (re, im). */
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const nr = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = nr
      }
    }
  }
}

/** Onset strength per hop (positive change of log spectrum), normalised. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number): { env: Float32Array; rate: number } {
  // Box-filter downsample: beats live well below 6 kHz.
  const step = Math.max(1, Math.round(sampleRate / TARGET_RATE))
  const rate = sampleRate / step
  const n = Math.floor(mono.length / step)
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < step; j++) sum += mono[i * step + j]
    x[i] = sum / step
  }
  const frames = Math.max(0, Math.floor((n - WINDOW) / HOP) + 1)
  const env = new Float32Array(frames)
  const re = new Float32Array(WINDOW)
  const im = new Float32Array(WINDOW)
  const hann = Float32Array.from({ length: WINDOW }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WINDOW))
  let prev = new Float32Array(WINDOW / 2)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < WINDOW; i++) {
      re[i] = x[f * HOP + i] * hann[i]
      im[i] = 0
    }
    fft(re, im)
    const mag = new Float32Array(WINDOW / 2)
    let flux = 0
    for (let k = 1; k < WINDOW / 2; k++) {
      mag[k] = Math.log1p(1000 * Math.hypot(re[k], im[k]))
      flux += Math.max(0, mag[k] - prev[k])
    }
    env[f] = f ? flux : 0
    prev = mag
  }
  // Remove the slow trend and normalise.
  let mean = 0
  for (const v of env) mean += v
  mean /= env.length || 1
  let sd = 0
  for (const v of env) sd += (v - mean) ** 2
  sd = Math.sqrt(sd / (env.length || 1)) || 1
  for (let i = 0; i < env.length; i++) env[i] = Math.max(0, (env[i] - mean) / sd)
  return { env, rate: rate / HOP }
}

/** Beat period in envelope frames, from autocorrelation weighted towards ~120 BPM. */
export function estimatePeriod(env: Float32Array, rate: number): number {
  const minLag = Math.floor((rate * 60) / 200)
  const maxLag = Math.ceil((rate * 60) / 55)
  let best = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= Math.min(maxLag, env.length - 1); lag++) {
    let sum = 0
    for (let i = lag; i < env.length; i++) sum += env[i] * env[i - lag]
    const bpm = (60 * rate) / lag
    const weight = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2)
    const score = (sum / (env.length - lag)) * weight
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  return best
}

/** Beat times (seconds) in a mono signal. */
export function detectBeats(mono: Float32Array, sampleRate: number): { beats: number[]; bpm: number } {
  const { env, rate } = onsetEnvelope(mono, sampleRate)
  if (env.length < 8) return { beats: [], bpm: 0 }
  const period = estimatePeriod(env, rate)
  const tightness = 100
  const score = new Float32Array(env.length)
  const back = new Int32Array(env.length).fill(-1)
  for (let t = 0; t < env.length; t++) {
    let best = 0
    let from = -1
    for (let prev = t - 2 * period; prev <= t - Math.round(period / 2); prev++) {
      if (prev < 0) continue
      const penalty = -tightness * Math.log((t - prev) / period) ** 2
      if (score[prev] + penalty > best) {
        best = score[prev] + penalty
        from = prev
      }
    }
    score[t] = env[t] + best
    back[t] = from
  }
  // Start from the best-scoring frame near the end and walk back.
  let t = Math.max(0, env.length - period)
  for (let i = t; i < env.length; i++) if (score[i] > score[t]) t = i
  const frames: number[] = []
  while (t >= 0) {
    frames.push(t)
    t = back[t]
  }
  // Envelope frame f covers samples starting at f*HOP; report the window centre.
  const offset = WINDOW / 2 / HOP
  const beats = frames.reverse().map((f) => (f + offset) / rate)
  return { beats, bpm: (60 * rate) / period }
}
