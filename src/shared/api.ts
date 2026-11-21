import type { ComponentId, ComponentStatus } from './components'
import type { EncoderInfo, ExportFormat, ExportRequest } from './export'
import type { JobEvent, JobInput, JobKind } from './jobs'
import type { Asset, AspectPreset, Project, ProjectSummary } from './project/schema'
import type { SecretName, Settings } from './settings'
import type { PhotoCatalog, PhotoProbe } from './photo'

export interface AppInfo {
  version: string
  platform: string
  projectsDir: string
  logsDir: string
}

export interface OpenedProject {
  project: Project
  dir: string
  /** Asset ids whose files are missing on disk. */
  missing: string[]
  /** True when project.json was damaged and the newest backup was restored. */
  recovered: boolean
}

export type ProbeResult = { ok: true; path: string; asset: Omit<Asset, 'id'> } | { ok: false; path: string; error: string }

/** A font file the user added (registered under `family`). */
export interface CustomFont {
  family: string
  path: string
}

export interface SfxItem {
  id: string
  category: string
  path: string
  duration: number
}

/** The API the preload exposes as `window.maker`. Every method is an IPC call to main. */
export interface MakerApi {
  app: {
    info(): Promise<AppInfo>
    revealPath(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    copyText(text: string): Promise<void>
    log(level: 'info' | 'warn' | 'error', scope: string, message: string): Promise<void>
  }
  projects: {
    list(): Promise<ProjectSummary[]>
    create(input: { name: string; aspect: AspectPreset; fps: number }): Promise<OpenedProject>
    open(id: string): Promise<OpenedProject>
    save(project: Project): Promise<{ savedAt: number }>
    rename(id: string, name: string): Promise<void>
    duplicate(id: string, name: string): Promise<ProjectSummary>
    trash(id: string): Promise<void>
    saveThumbnail(id: string, jpegDataUrl: string): Promise<void>
  }
  templates: {
    list(): Promise<ProjectSummary[]>
    /** Saves a copy of the project (with its media) as a template. */
    saveFrom(projectId: string, name: string): Promise<ProjectSummary>
    create(templateId: string, name: string): Promise<OpenedProject>
    remove(id: string): Promise<void>
  }
  media: {
    pickFiles(filter: 'media' | 'audio'): Promise<string[]>
    pickFile(filter: 'media' | 'audio'): Promise<string | null>
    probe(paths: string[]): Promise<ProbeResult[]>
    exists(paths: string[]): Promise<boolean[]>
    sfx(): Promise<SfxItem[]>
    /** Copies a built-in file (e.g. a sound effect) into the project folder; returns the copy's path. */
    copyToProject(projectId: string, path: string): Promise<string>
    /** Lets the user pick a folder and finds files with these names in it (lower-case name → path). */
    findInFolder(names: string[]): Promise<Record<string, string>>
    /** Copies the project's media files from outside its folder into it; returns old → new paths. */
    collect(projectId: string, paths: string[]): Promise<Record<string, string>>
    /** Stores a microphone recording (WebM) in the project as AAC; returns the file path. */
    saveRecording(projectId: string, data: Uint8Array): Promise<string>
    /** Lets the user pick a .cube LUT and copies it into the project; null when cancelled. */
    importLut(projectId: string): Promise<{ path: string; name: string } | null>
  }
  jobs: {
    start<K extends JobKind>(kind: K, input: JobInput<K>, label: string): Promise<string>
    cancel(jobId: string): Promise<void>
    onEvent(listener: (event: JobEvent) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    secrets(): Promise<Record<SecretName, boolean>>
    setSecret(name: SecretName, value: string | null): Promise<void>
  }
  components: {
    list(): Promise<ComponentStatus[]>
    remove(id: ComponentId): Promise<void>
  }
  fonts: {
    list(): Promise<CustomFont[]>
    /** Lets the user pick font files and copies them into Maker's font folder. */
    import(): Promise<CustomFont[]>
    remove(path: string): Promise<void>
  }
  photos: {
    load(): Promise<PhotoCatalog>
    save(catalog: PhotoCatalog): Promise<void>
    /** File dialog for photos. */
    pick(): Promise<string[]>
    /** Validates files and makes displayable copies of TIFF / HEIC. */
    prepare(paths: string[]): Promise<PhotoProbe[]>
    pickFolder(): Promise<string | null>
    /** Saves an exported image into `dir` (never overwrites); returns the written path. */
    writeExport(dir: string, name: string, data: Uint8Array): Promise<string>
    /** A new folder for photos rendered to be used in a video project. */
    videoDir(): Promise<string>
  }
  export: {
    /** Save dialog for an export; `ext` picks the file type (mp4, gif, m4a, mp3, wav, png). */
    pickOutput(defaultName: string, format?: ExportFormat, ext?: string): Promise<string | null>
    encoders(): Promise<EncoderInfo>
  }
}

/** Shape of IPC handlers in main: same as MakerApi minus the event subscription. */
export type ApiHandlers = {
  [NS in keyof MakerApi]: {
    [M in keyof MakerApi[NS] as M extends 'onEvent' ? never : M]: MakerApi[NS][M]
  }
}

export const JOB_EVENT_CHANNEL = 'jobs:event'

/** Bridge exposed to the hidden export window as `window.makerExport`. */
export interface ExportSession {
  jobId: string
  request: ExportRequest
  project: Project
  projectDir: string
  encoder: string
  ffmpeg: string
}

export interface DecoderSpec {
  path: string
  /** Source time of frame 0. */
  start: number
  /** Decode rate (source frames per second, constant). */
  fps: number
  width: number
  height: number
  /** Decode with alpha (VP9 alpha renders). */
  alpha: boolean
}

export interface ExportBridge {
  session(): Promise<ExportSession>
  openDecoder(spec: DecoderSpec): Promise<number>
  /** Returns RGBA frame `index` (counted from spec.start at spec.fps); null past the end. */
  readFrame(decoderId: number, index: number): Promise<Uint8Array | null>
  closeDecoder(decoderId: number): Promise<void>
  writeAudio(channels: Float32Array[], sampleRate: number): Promise<string>
  openEncoder(audioPath: string): Promise<void>
  writeFrame(rgba: Uint8Array): Promise<void>
  finishEncoder(): Promise<void>
  progress(progress: number, message?: string): void
  done(output: { path: string; seconds: number; encoder: string }): void
  fail(message: string): void
  onCancel(listener: () => void): void
}

/** URL the renderer uses to load a local file through the `media://` protocol. */
export function toMediaUrl(absolutePath: string): string {
  return `media://file/${encodeURIComponent(absolutePath)}`
}
