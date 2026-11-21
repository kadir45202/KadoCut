import { create } from 'zustand'

/** Which clip shows on-canvas crop handles. */
export const useCropMode = create<{ clipId: string | null }>(() => ({ clipId: null }))
