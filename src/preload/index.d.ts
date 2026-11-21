import type { ExportBridge, MakerApi } from '@shared/api'

declare global {
  interface Window {
    maker: MakerApi
    makerFiles: { pathFor(file: File): string }
    /** Only present in the hidden export window. */
    makerExport?: ExportBridge
  }
}

export {}
