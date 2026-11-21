import { mediaUrl } from '@renderer/lib/api'

/** A 3D colour lookup table: size³ RGB entries, red varying fastest (the .cube order). */
export interface Lut {
  key: string
  size: number
  data: Float32Array
}

/** Parses an Adobe/Resolve `.cube` 3D LUT, normalising DOMAIN_MIN/MAX to 0..1. */
export function parseCube(text: string, key = ''): Lut {
  let size = 0
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  const values: number[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const head = parts[0].toUpperCase()
    if (head === 'LUT_3D_SIZE') size = Number(parts[1])
    else if (head === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number)
    else if (head === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number)
    else if (head === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported')
    else if (/^[-+.\d]/.test(head) && parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]))
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) throw new Error('Missing or invalid LUT_3D_SIZE')
  if (values.length !== size * size * size * 3) throw new Error(`Expected ${size ** 3} entries, found ${values.length / 3}`)
  const data = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) {
    const c = i % 3
    data[i] = Math.min(1, Math.max(0, (values[i] - min[c]) / (max[c] - min[c] || 1)))
  }
  return { key, size, data }
}

const cache = new Map<string, Promise<Lut>>()
const loaded = new Map<string, Lut>()

/** Loads and parses a LUT file once; resolves to the parsed table. */
export function loadLut(path: string): Promise<Lut> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(mediaUrl(path))
      .then((r) => {
        if (!r.ok) throw new Error(`LUT ${r.status}`)
        return r.text()
      })
      .then((text) => {
        const lut = parseCube(text, path)
        loaded.set(path, lut)
        return lut
      })
    p.catch(() => cache.delete(path))
    cache.set(path, p)
  }
  return p
}

/** Synchronous access to an already-loaded LUT. */
export const loadedLut = (path: string): Lut | undefined => loaded.get(path)
