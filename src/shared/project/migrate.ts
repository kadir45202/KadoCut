import { defaultAnim, defaultAudio, defaultCurves, defaultStabilize, defaultTextStyle, defaultVisualProps } from './defaults'
import { Project, PROJECT_SCHEMA_VERSION } from './schema'

export class ProjectFormatError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'too-new'
  ) {
    super(message)
  }
}

type Json = Record<string, unknown>

/** v2: transitions, blend modes, colour correction, crop and audio ducking. */
function upgradeV1(data: Json): Json {
  const clips = (data.clips ?? {}) as Record<string, Json>
  for (const clip of Object.values(clips)) {
    if (clip.kind === 'video' || clip.kind === 'image') {
      for (const [key, value] of Object.entries(defaultVisualProps())) if (!(key in clip)) clip[key] = value
    }
    const audio = clip.audio as Json | undefined
    if (audio && !('ducking' in audio)) audio.ducking = defaultAudio().ducking
  }
  return { ...data, schemaVersion: 2 }
}

/** v3: animations, caption highlight modes, audio EQ / compressor, beats, transcripts, loudness. */
function upgradeV2(data: Json): Json {
  const clips = (data.clips ?? {}) as Record<string, Json>
  for (const clip of Object.values(clips)) {
    if (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'text') clip.anim ??= defaultAnim()
    if (clip.kind === 'text') {
      const style = clip.style as Json
      style.highlightMode ??= defaultTextStyle().highlightMode
      style.reveal ??= defaultTextStyle().reveal
    }
    const audio = clip.audio as Json | undefined
    if (audio) {
      audio.eq ??= defaultAudio().eq
      audio.compressor ??= defaultAudio().compressor
    }
  }
  for (const asset of Object.values((data.assets ?? {}) as Record<string, Json>)) {
    asset.beats ??= []
    asset.transcript ??= null
  }
  const settings = data.settings as Json | undefined
  if (settings) settings.loudness ??= { enabled: false, target: -14 }
  return { ...data, schemaVersion: 3 }
}

/** v4: timeline markers, in / out range, voice changer, stabilization, tone curves, more effects. */
function upgradeV3(data: Json): Json {
  const visit = (clips: Record<string, Json>) => {
    for (const clip of Object.values(clips)) {
      const audio = clip.audio as Json | undefined
      if (audio) audio.voice ??= 'none'
      if (clip.kind === 'video') clip.stabilize ??= defaultStabilize()
      const color = clip.color as Json | undefined
      if (color) color.curves ??= defaultCurves()
      if (clip.kind === 'compound') visit((clip.clips ?? {}) as Record<string, Json>)
    }
  }
  visit((data.clips ?? {}) as Record<string, Json>)
  return { ...data, markers: data.markers ?? [], range: data.range ?? null, schemaVersion: 4 }
}

/**
 * Brings any stored project up to the current schema and validates it.
 * Each step upgrades exactly one version, so old files walk the whole chain.
 */
export function migrateProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new ProjectFormatError('Project file is empty', 'invalid')
  let data = raw as Json
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0

  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectFormatError(`Project was saved by a newer Maker (format v${version})`, 'too-new')
  }
  if (version === 1) data = upgradeV1(data)
  if (version <= 2) data = upgradeV2(data)
  if (version <= 3) data = upgradeV3(data)

  const parsed = Project.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ProjectFormatError(`Invalid project: ${issue?.path.join('.')} ${issue?.message}`, 'invalid')
  }
  return parsed.data
}
