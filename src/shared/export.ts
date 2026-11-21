export type ExportCodec = 'h264' | 'hevc'

/** MP4 video, animated GIF, sound only (.m4a / .mp3 / .wav) or a single still frame (.png). */
export type ExportFormat = 'mp4' | 'gif' | 'audio' | 'png'

/** File extensions each format may write. */
export const FORMAT_EXTENSIONS: Record<ExportFormat, string[]> = {
  mp4: ['mp4'],
  gif: ['gif'],
  audio: ['m4a', 'mp3', 'wav'],
  png: ['png']
}

export interface ExportPreset {
  id: string
  width: number
  height: number
  fps: number
  /** Target video bitrate in Mbit/s. */
  bitrate: number
}

/** Social-media-ready presets (H.264/MP4, bitrates per platform recommendations). */
export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'reels-1080-30', width: 1080, height: 1920, fps: 30, bitrate: 12 },
  { id: 'reels-1080-60', width: 1080, height: 1920, fps: 60, bitrate: 18 },
  { id: 'youtube-1080-30', width: 1920, height: 1080, fps: 30, bitrate: 12 },
  { id: 'youtube-1080-60', width: 1920, height: 1080, fps: 60, bitrate: 18 },
  { id: 'square-1080-30', width: 1080, height: 1080, fps: 30, bitrate: 10 },
  { id: 'square-1080-60', width: 1080, height: 1080, fps: 60, bitrate: 15 },
  { id: 'portrait-1080-30', width: 1080, height: 1350, fps: 30, bitrate: 11 },
  { id: 'portrait-1080-60', width: 1080, height: 1350, fps: 60, bitrate: 16 }
]

export interface ExportRequest {
  projectId: string
  outputPath: string
  format: ExportFormat
  /** Timeline range to render (in/out points, or the frame for a still); null = everything. */
  range: { start: number; end: number } | null
  width: number
  height: number
  fps: number
  bitrate: number
  codec: ExportCodec
  /** Use NVENC / AMF / QSV when available. */
  hardware: boolean
  /** Decoded audio for the mix: media path (or `path|rate` for stretches) → PCM file. */
  audio: Record<string, string>
  /** Locale for text case mapping (Turkish i/İ). */
  locale: string
  /** When the output aspect differs from the project: crop to fill, or fit with borders. */
  fit: 'fill' | 'fit'
  /** User-added fonts the export window must register before drawing text. */
  fonts: { family: string; path: string }[]
}

export interface EncoderInfo {
  h264: string[]
  hevc: string[]
}
