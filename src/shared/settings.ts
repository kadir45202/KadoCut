import { z } from 'zod'
import { TextStyle } from './project/schema'

export const Language = z.enum(['tr', 'en'])
export type Language = z.infer<typeof Language>

export const Settings = z.object({
  language: Language,
  previewQuality: z.enum(['full', 'half', 'quarter']),
  snapping: z.boolean(),
  /** Module ids the user switched off in Settings > Modules. */
  disabledModules: z.array(z.string()),
  captions: z.object({
    model: z.enum(['base', 'small', 'large-v3-turbo']),
    language: z.enum(['auto', 'tr', 'en']),
    /** Caption looks the user saved. */
    styles: z.array(z.object({ id: z.string(), name: z.string().min(1).max(60), style: TextStyle }))
  }),
  /** Key combos per command id, overriding the module defaults. */
  shortcuts: z.record(z.string(), z.array(z.string())),
  /** Preview high-resolution video (above 1080p) from a lighter proxy copy. */
  proxyLarge: z.boolean(),
  /** Viewer overlays: platform safe zones, thirds grid, colour scopes. */
  viewer: z.object({
    safeZone: z.enum(['none', 'reels', 'tiktok', 'shorts']),
    grid: z.boolean(),
    scopes: z.boolean()
  }),
  tts: z.object({
    /** ElevenLabs voice id used when a key is present. */
    elevenVoiceId: z.string()
  }),
  lastExportDir: z.string(),
  /** Version of the "what's new" notes the user has seen. */
  whatsNewSeen: z.string()
})
export type Settings = z.infer<typeof Settings>

export const DEFAULT_SETTINGS: Settings = {
  language: 'tr',
  previewQuality: 'half',
  snapping: true,
  disabledModules: [],
  captions: { model: 'large-v3-turbo', language: 'auto', styles: [] },
  shortcuts: {},
  proxyLarge: false,
  viewer: { safeZone: 'none', grid: false, scopes: false },
  // "Rachel" — a multilingual stock voice available on every ElevenLabs account.
  tts: { elevenVoiceId: '21m00Tcm4TlvDq8EAACZ' },
  lastExportDir: '',
  whatsNewSeen: ''
}

/** Cloud providers whose API keys are stored encrypted (never sent to the renderer). */
export const SecretName = z.enum(['elevenlabs', 'replicate', 'anthropic'])
export type SecretName = z.infer<typeof SecretName>
