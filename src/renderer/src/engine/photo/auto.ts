import type { PhotoDevelop } from '@shared/photo'

const clamp = (v: number, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, v))
const round = (v: number) => Math.round(v * 100) / 100

/**
 * "Auto" tone like Lightroom's: from the photo's luminance distribution, brings the middle grey
 * to a pleasant level and stretches the black / white points, with a gentle vibrance lift.
 * `rgba` is a small, unedited copy of the photo.
 */
export function autoTone(rgba: Uint8ClampedArray): Partial<PhotoDevelop> {
  const hist = new Uint32Array(256)
  let count = 0
  let sumLinear = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const l = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]
    hist[Math.min(255, Math.round(l))]++
    sumLinear += (l / 255) ** 2.2
    count++
  }
  if (!count) return {}
  const percentile = (p: number) => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= count * p) return v / 255
    }
    return 1
  }
  const low = percentile(0.005)
  const high = percentile(0.995)
  const meanLinear = sumLinear / count
  // Middle grey (18 % reflectance) at ~0.18 linear; keep the correction modest.
  const exposure = clamp(Math.log2(0.18 / Math.max(meanLinear, 1e-4)) * 0.7, -2, 2)
  const whites = clamp((0.98 - high) * 2.5)
  const blacks = clamp((0.02 - low) * 2.5)
  // Flat (low-range) photos get a little contrast.
  const range = high - low
  const contrast = clamp((0.85 - range) * 0.6, 0, 0.35)
  return { exposure: round(exposure), whites: round(whites), blacks: round(blacks), contrast: round(contrast), vibrance: 0.15 }
}
