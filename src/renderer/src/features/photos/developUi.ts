import { create } from 'zustand'
import type { PhotoDevelop } from '@shared/photo'

export interface BrushSettings {
  /** Radius as a fraction of the photo's long edge. */
  size: number
  feather: number
  erase: boolean
}

/** View state of the Develop screen (not saved). */
export const useDevelopUi = create<{
  /** Show the unedited photo (\\ key). */
  before: boolean
  /** Crop tool open: the whole frame is drawn with the crop rectangle over it (R key). */
  cropping: boolean
  /** Preset under the pointer, previewed live. */
  hover: Partial<PhotoDevelop> | null
  /** Mask being edited (its handles / brush are on the photo). */
  mask: string | null
  /** Red overlay over the edited mask (O key). */
  overlay: boolean
  brush: BrushSettings
  /** Clipping warning (J key). */
  clip: boolean
  /** 1:1 view (Z key) and its centre in crop fractions. */
  zoom: boolean
  center: [number, number]
}>(() => ({
  before: false,
  cropping: false,
  hover: null,
  mask: null,
  overlay: true,
  brush: { size: 0.04, feather: 0.6, erase: false },
  clip: false,
  zoom: false,
  center: [0.5, 0.5]
}))
