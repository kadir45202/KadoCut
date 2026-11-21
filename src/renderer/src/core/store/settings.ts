import { create } from 'zustand'
import { DEFAULT_SETTINGS, type SecretName, type Settings } from '@shared/settings'
import { useLanguage } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'

interface SettingsState {
  settings: Settings
  secrets: Record<SecretName, boolean>
  loaded: boolean
}

export const useSettings = create<SettingsState>(() => ({
  settings: DEFAULT_SETTINGS,
  secrets: { elevenlabs: false, replicate: false, anthropic: false },
  loaded: false
}))

export const settingsActions = {
  async load() {
    try {
      const [settings, secrets] = await Promise.all([api.settings.get(), api.settings.secrets()])
      useLanguage.getState().setLang(settings.language)
      useSettings.setState({ settings, secrets, loaded: true })
    } catch (err) {
      log.error('settings', 'load failed', err)
      useSettings.setState({ loaded: true })
    }
  },
  async update(patch: Partial<Settings>) {
    // Optimistic so toggles feel instant; main validates and returns the stored value.
    useSettings.setState((s) => ({ settings: { ...s.settings, ...patch } }))
    if (patch.language) useLanguage.getState().setLang(patch.language)
    const settings = await api.settings.set(patch)
    useSettings.setState({ settings })
  },
  async setSecret(name: SecretName, value: string | null) {
    await api.settings.setSecret(name, value)
    useSettings.setState({ secrets: await api.settings.secrets() })
  }
}
