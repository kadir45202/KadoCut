/**
 * Integrated loudness (ITU-R BS.1770-4, LUFS) and normalisation with a peak limiter, applied to
 * the exported mix. Coefficients are for 48 kHz, the mixer's fixed rate.
 */

const SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] }
const HIGHPASS = { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] }

function biquad(input: Float32Array, f: { b: number[]; a: number[] }): Float32Array {
  const out = new Float32Array(input.length)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < input.length; i++) {
    const x = input[i]
    const y = f.b[0] * x + f.b[1] * x1 + f.b[2] * x2 - f.a[0] * y1 - f.a[1] * y2
    x2 = x1
    x1 = x
    y2 = y1
    y1 = y
    out[i] = y
  }
  return out
}

/** Integrated loudness of a stereo mix in LUFS (-Infinity for silence). */
export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const weighted = channels.map((c) => biquad(biquad(c, SHELF), HIGHPASS))
  const block = Math.round(0.4 * sampleRate)
  const step = Math.round(0.1 * sampleRate)
  const powers: number[] = []
  for (let start = 0; start + block <= weighted[0].length; start += step) {
    let sum = 0
    for (const ch of weighted) for (let i = start; i < start + block; i++) sum += ch[i] * ch[i]
    powers.push(sum / block)
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p)
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length
  const absolute = powers.filter((p) => lufs(p) > -70)
  if (!absolute.length) return -Infinity
  const relative = lufs(mean(absolute)) - 10
  const gated = absolute.filter((p) => lufs(p) > relative)
  return lufs(mean(gated.length ? gated : absolute))
}

/**
 * Scales the mix to `target` LUFS and keeps sample peaks under -1 dBFS with a look-ahead
 * limiter. Returns the gain that was applied in dB.
 */
export function normalizeLoudness(channels: Float32Array[], sampleRate: number, target: number): number {
  const measured = integratedLoudness(channels, sampleRate)
  if (!Number.isFinite(measured)) return 0
  const gainDb = target - measured
  const gain = 10 ** (gainDb / 20)
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= gain
  limit(channels, sampleRate, 10 ** (-1 / 20))
  return gainDb
}

/** Peak limiter: instant attack ahead of peaks (5 ms look-ahead), 80 ms release. */
export function limit(channels: Float32Array[], sampleRate: number, ceiling: number) {
  const n = channels[0].length
  const need = new Float32Array(n)
  let any = false
  for (let i = 0; i < n; i++) {
    let peak = 0
    for (const ch of channels) peak = Math.max(peak, Math.abs(ch[i]))
    need[i] = peak > ceiling ? ceiling / peak : 1
    if (need[i] < 1) any = true
  }
  if (!any) return
  const ahead = Math.round(0.005 * sampleRate)
  // Sliding minimum over the look-ahead window (monotonic deque), so the gain is already down
  // when a peak arrives.
  const env = new Float32Array(n)
  const deque = new Int32Array(n)
  let head = 0
  let tail = 0
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[deque[tail - 1]] >= need[i]) tail--
    deque[tail++] = i
    while (deque[head] > i + ahead) head++
    env[i] = need[deque[head]]
  }
  const attack = 1 - Math.exp(-5 / ahead)
  const release = 1 - Math.exp(-1 / (0.08 * sampleRate))
  let g = 1
  for (let i = 0; i < n; i++) {
    g += (env[i] - g) * (env[i] < g ? attack : release)
    for (const ch of channels) ch[i] = Math.max(-ceiling, Math.min(ceiling, ch[i] * g))
  }
}
