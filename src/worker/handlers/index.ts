import type { JobInput, JobKind, JobOutput } from '@shared/jobs'
import type { JobContext } from '../context'
import { denoise, extractAudio, stretchAudio } from './audio'
import { removeBackground } from './background'
import { transcribe } from './captions'
import { installComponent } from './components'
import { analyzeAudio, filmstrip, freezeFrame, proxy } from './media'
import { synthesize } from './tts'
import { detectFaces, trackPoint } from './vision'
import { stabilize } from './stabilize'
import { reverseVideo } from './reverse'
import { highlights, translate } from './ai'

type Handler<K extends JobKind> = (input: JobInput<K>, ctx: JobContext) => Promise<JobOutput<K>>

/** Worker-side job implementations. `export.render` runs in the export window instead. */
export const handlers: { [K in Exclude<JobKind, 'export.render'>]: Handler<K> } & Partial<Record<JobKind, unknown>> = {
  'media.audio': analyzeAudio,
  'media.filmstrip': filmstrip,
  'media.proxy': proxy,
  'media.freezeFrame': freezeFrame,
  'audio.extract': extractAudio,
  'audio.stretch': stretchAudio,
  'audio.denoise': denoise,
  'video.removeBackground': removeBackground,
  'video.stabilize': stabilize,
  'video.reverse': reverseVideo,
  'video.detectFaces': detectFaces,
  'video.track': trackPoint,
  'ai.translate': translate,
  'ai.highlights': highlights,
  'captions.transcribe': transcribe,
  'tts.synthesize': synthesize,
  'components.install': installComponent
}
