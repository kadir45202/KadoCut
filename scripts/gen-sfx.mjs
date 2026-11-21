// Synthesizes Maker's built-in sound effects (royalty-free by construction) into resources/sfx.
// Run: npm run gen:sfx
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 48000
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'sfx')
mkdirSync(out, { recursive: true })

// Deterministic noise so regenerating gives identical files.
let seed = 1234567
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const noise = () => rand() * 2 - 1

function buffer(seconds) {
  return new Float32Array(Math.round(seconds * SR))
}

/** Two-pole resonant bandpass (state-variable filter) with time-varying cutoff. */
function bandpass(input, cutoffAt, q = 1.5) {
  const out = new Float32Array(input.length)
  let low = 0
  let band = 0
  for (let i = 0; i < input.length; i++) {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoffAt(i / SR), SR / 6)) / SR)
    const high = input[i] - low - band / q
    band += f * high
    low += f * band
    out[i] = band
  }
  return out
}

function lowpass(input, cutoff) {
  const out = new Float32Array(input.length)
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR)
  let y = 0
  for (let i = 0; i < input.length; i++) out[i] = y += a * (input[i] - y)
  return out
}

function highpass(input, cutoff) {
  const lp = lowpass(input, cutoff)
  return input.map((v, i) => v - lp[i])
}

/** Sine with a frequency function; returns samples for `seconds`. */
function sweep(seconds, freqAt, amp = 1) {
  const b = buffer(seconds)
  let phase = 0
  for (let i = 0; i < b.length; i++) {
    phase += (2 * Math.PI * freqAt(i / SR)) / SR
    b[i] = Math.sin(phase) * amp
  }
  return b
}

const env = (b, fn) => b.map((v, i) => v * fn(i / SR, b.length / SR))
const mix = (...parts) => {
  const len = Math.max(...parts.map((p) => p.length))
  const o = new Float32Array(len)
  for (const p of parts) for (let i = 0; i < p.length; i++) o[i] += p[i]
  return o
}
const at = (b, seconds, total) => {
  const o = buffer(total)
  const off = Math.round(seconds * SR)
  for (let i = 0; i < b.length && off + i < o.length; i++) o[off + i] = b[i]
  return o
}
const decay = (rate) => (t) => Math.exp(-t * rate)
const attackDecay = (attack, rate) => (t) => Math.min(1, t / attack) * Math.exp(-Math.max(0, t - attack) * rate)
const bell = (t, d) => Math.sin(Math.PI * Math.min(1, t / d)) ** 2

function tone(freq, seconds, rate, partials = [[1, 1]]) {
  return env(
    mix(...partials.map(([mult, amp]) => sweep(seconds, () => freq * mult, amp))),
    attackDecay(0.004, rate)
  )
}

const white = (s) => buffer(s).map(noise)

const sounds = {
  whoosh: ['transition', () => env(bandpass(white(0.75), (t) => 300 + 2600 * Math.sin((Math.PI * t) / 0.75), 2.2), bell)],
  swoosh: ['transition', () => env(bandpass(white(0.38), (t) => 900 + 5200 * (t / 0.38), 1.8), bell)],
  swipe: ['transition', () => env(highpass(white(0.24), 2500), (t, d) => bell(t, d) * 0.8)],
  riser: [
    'transition',
    () =>
      env(
        mix(bandpass(white(2.2), (t) => 300 + 4000 * (t / 2.2) ** 2, 3), sweep(2.2, (t) => 180 + 900 * (t / 2.2) ** 1.6, 0.35)),
        (t, d) => (t / d) ** 2 * (t > d - 0.05 ? (d - t) / 0.05 : 1)
      )
  ],
  pop: ['ui', () => env(sweep(0.14, (t) => 180 + 900 * Math.exp(-t * 45)), attackDecay(0.002, 38))],
  click: ['ui', () => mix(env(highpass(white(0.05), 1800), decay(160)), env(sweep(0.05, () => 2200, 0.4), decay(120)))],
  ding: ['ui', () => tone(1318.5, 1.4, 3.2, [[1, 1], [2.01, 0.35], [3.02, 0.15]])],
  notification: ['ui', () => mix(at(tone(880, 0.5, 6, [[1, 1], [2, 0.2]]), 0, 0.95), at(tone(1318.5, 0.6, 5, [[1, 1], [2, 0.2]]), 0.16, 0.95))],
  success: [
    'ui',
    () => {
      const notes = [523.25, 659.25, 783.99, 1046.5]
      return mix(...notes.map((f, i) => at(tone(f, 0.6, 6, [[1, 1], [2, 0.15]]), i * 0.08, 1.0)))
    }
  ],
  error: [
    'ui',
    () => env(lowpass(sweep(0.5, () => 160).map((v) => Math.sign(v) * 0.6), 2400), (t, d) => (0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 18)) * (t > d - 0.05 ? (d - t) / 0.05 : 1))
  ],
  boom: ['impact', () => mix(env(sweep(1.3, (t) => 40 + 70 * Math.exp(-t * 6)), attackDecay(0.003, 3)), env(lowpass(white(1.3), 900), attackDecay(0.002, 9)))],
  glitch: [
    'impact',
    () => {
      const b = buffer(0.55)
      let hold = 0
      for (let i = 0; i < b.length; i++) {
        if (i % 220 === 0) hold = noise() * (rand() > 0.3 ? 1 : 0)
        const t = i / SR
        const gate = Math.sin(t * 2 * Math.PI * 23) > -0.2 ? 1 : 0
        b[i] = Math.round(hold * 6) / 6 * gate * 0.7 + Math.sin(t * 2 * Math.PI * (300 + 600 * rand())) * 0.15 * gate
      }
      return env(b, (t, d) => (t > d - 0.04 ? (d - t) / 0.04 : 1))
    }
  ],
  shutter: [
    'fun',
    () => {
      const clack = () => env(bandpass(white(0.08), () => 3200, 1.2), decay(70))
      return mix(at(clack(), 0, 0.3), at(clack().map((v) => v * 0.8), 0.11, 0.3))
    }
  ],
  boing: ['fun', () => env(sweep(0.7, (t) => 260 + 140 * Math.sin(t * 2 * Math.PI * 11) * Math.exp(-t * 4) + 60 * t), attackDecay(0.005, 4.5))],
  typing: [
    'fun',
    () => {
      const parts = []
      for (let i = 0; i < 9; i++) {
        const key = env(bandpass(white(0.04), () => 1800 + rand() * 1600, 1.6), decay(150))
        parts.push(at(key.map((v) => v * (0.6 + rand() * 0.4)), i * 0.12 + rand() * 0.04, 1.25))
      }
      return mix(...parts)
    }
  ],
  sparkle: [
    'fun',
    () => {
      const parts = []
      for (let i = 0; i < 14; i++) parts.push(at(tone(2000 + rand() * 3500, 0.35, 14), rand() * 0.7, 1.1).map((v) => v * 0.5))
      return mix(...parts)
    }
  ]
}

function normalize(b, peakDb = -1) {
  let peak = 0
  for (const v of b) peak = Math.max(peak, Math.abs(v))
  const k = peak > 0 ? 10 ** (peakDb / 20) / peak : 1
  return b.map((v) => v * k)
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2))
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SR, 24)
  h.writeUInt32LE(SR * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

const index = []
for (const [id, [category, make]] of Object.entries(sounds)) {
  const samples = normalize(make())
  writeFileSync(join(out, `${id}.wav`), wav(samples))
  index.push({ id, category, file: `${id}.wav`, duration: Math.round((samples.length / SR) * 1000) / 1000 })
}
writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2))
console.log(`Generated ${index.length} sound effects in ${out}`)
