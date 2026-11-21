import type { Crop } from '@shared/project/schema'

/** Largest centred crop of a w×h frame with the given aspect ratio. */
export function cropForRatio(w: number, h: number, ratio: number): Pick<Crop, 'left' | 'right' | 'top' | 'bottom'> {
  if (w / h > ratio) {
    const side = (1 - (h * ratio) / w) / 2
    return { left: side, right: side, top: 0, bottom: 0 }
  }
  const side = (1 - w / ratio / h) / 2
  return { left: 0, right: 0, top: side, bottom: side }
}
