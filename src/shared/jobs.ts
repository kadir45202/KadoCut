import type { ComponentId, WhisperModel } from './components'
import type { ExportRequest } from './export'

/**
 * Every heavy operation is a job. Jobs run in their own utility process (or, for export, a
 * hidden render window) so a crash or hang only fails that job — never the editor.
 *
 * `input` is what the renderer sends; main resolves paths/secrets before the worker sees it.
 */
export interface JobSpecs {
  /** Decode audio to 48 kHz stereo float PCM + waveform peaks (cached per file). */
  'media.audio': {
    input: { path: string }
    output: { pcmPath: string; peaksPath: string; sampleRate: number; channels: number; frames: number; peaksPerSecond: number }
  }
  /** Thumbnail strip for timeline clips (cached per file). */
  'media.filmstrip': {
    input: { path: string; duration: number }
    output: { path: string; count: number; interval: number; tileWidth: number; tileHeight: number }
  }
  /** H.264 preview copy for formats Chromium cannot play (cached per file). */
  'media.proxy': {
    input: { path: string }
    output: { path: string }
  }
  'media.freezeFrame': {
    input: { projectId: string; path: string; time: number }
    output: { path: string; width: number; height: number }
  }
  'audio.extract': {
    input: { projectId: string; path: string }
    output: { path: string; duration: number }
  }
  /** Pitch-preserving time stretch for constant-speed clips (cached per file+rate). */
  'audio.stretch': {
    input: { path: string; rate: number }
    output: { path: string }
  }
  'audio.denoise': {
    input: { projectId: string; path: string; strength: number }
    output: { path: string; provider: 'local' | 'elevenlabs'; warning?: string }
  }
  'video.removeBackground': {
    input: { projectId: string; path: string; duration: number }
    output: { path: string; provider: 'local' | 'replicate'; warning?: string }
  }
  /** A source range played backwards (picture and sound) as a new file. */
  'video.reverse': {
    input: { projectId: string; path: string; start: number; duration: number; hasAudio: boolean }
    output: { path: string }
  }
  /** Two-pass stabilization (vid.stab) into a new file of the same size and timing. */
  'video.stabilize': {
    input: { projectId: string; path: string; duration: number; strength: number }
    output: { path: string }
  }
  /** Face boxes (fractions of the frame) sampled at `fps` over a source range. */
  'video.detectFaces': {
    input: { path: string; start: number; duration: number; fps: number; width: number; height: number; threshold: number }
    output: { frames: { t: number; faces: { x: number; y: number; w: number; h: number; score: number }[] }[] }
  }
  /** Follows a patch through a source range; points are fractions of the frame. */
  'video.track': {
    input: { path: string; start: number; duration: number; fps: number; width: number; height: number; x: number; y: number; size: number }
    output: { points: { t: number; x: number; y: number; confident: boolean }[] }
  }
  /** Caption translation: Claude when a key is set, otherwise a local model (llama.cpp). */
  'ai.translate': {
    input: { lines: string[]; target: string }
    output: { lines: string[]; provider: 'claude' | 'local'; warning?: string }
  }
  /** Best short clips of a long video, from its transcript (source seconds). */
  'ai.highlights': {
    input: { words: { text: string; start: number; end: number }[]; count: number; minLength: number; maxLength: number; language: string }
    output: { clips: { start: number; end: number; title: string; reason: string }[]; provider: 'claude' | 'local'; warning?: string }
  }
  'captions.transcribe': {
    /** `prompt` primes the decoder (e.g. to keep hesitation sounds). */
    input: { path: string; start: number; duration: number; language: 'auto' | 'tr' | 'en'; model: WhisperModel; prompt?: string }
    /** Word times are in source-file seconds. */
    output: { language: string; words: { text: string; start: number; end: number }[] }
  }
  'tts.synthesize': {
    input: { projectId: string; text: string; language: 'tr' | 'en' }
    output: { path: string; duration: number; provider: 'local' | 'elevenlabs'; warning?: string }
  }
  'components.install': {
    input: { id: ComponentId }
    output: { id: ComponentId }
  }
  'export.render': {
    input: ExportRequest
    output: { path: string; seconds: number; encoder: string }
  }
}

export type JobKind = keyof JobSpecs
export type JobInput<K extends JobKind> = JobSpecs[K]['input']
export type JobOutput<K extends JobKind> = JobSpecs[K]['output']

export type JobErrorCode = 'cancelled' | 'crashed' | 'timeout' | 'missing-component' | 'provider' | 'failed'

export interface JobError {
  code: JobErrorCode
  message: string
  /** Every component the job needs that is not installed (code = missing-component). */
  componentIds?: ComponentId[]
}

export type JobEvent =
  | { type: 'started'; jobId: string; kind: JobKind; label: string }
  | { type: 'progress'; jobId: string; progress: number; message?: string }
  | { type: 'done'; jobId: string; output: unknown }
  | { type: 'error'; jobId: string; error: JobError }

/** Messages between main and a worker process. */
export type WorkerRequest = { type: 'run'; jobId: string; kind: JobKind; input: unknown; env: WorkerEnv } | { type: 'cancel' }

export type WorkerResponse =
  | { type: 'progress'; progress: number; message?: string }
  | { type: 'done'; output: unknown }
  | { type: 'error'; error: JobError }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }

/** Resolved environment main hands to a worker. */
export interface WorkerEnv {
  ffmpeg: string
  ffprobe: string
  cacheDir: string
  componentsDir: string
  /** Project media folder (for jobs that create project assets). */
  projectMediaDir: string
  /** Decrypted API keys for the job's provider, if configured. When present the cloud
   *  provider is used; when absent (or the call fails) the local implementation runs. */
  secrets: Partial<Record<'elevenlabs' | 'replicate' | 'anthropic', string>>
  elevenVoiceId: string
}
