import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { JOB_EVENT_CHANNEL, type MakerApi } from '@shared/api'
import type { JobEvent } from '@shared/jobs'

const call =
  (channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args)

const ns = <T extends string>(name: string, methods: T[]) =>
  Object.fromEntries(methods.map((m) => [m, call(`${name}:${m}`)])) as Record<T, (...args: unknown[]) => Promise<never>>

const api: MakerApi = {
  app: ns('app', ['info', 'revealPath', 'openExternal', 'copyText', 'log']),
  projects: ns('projects', ['list', 'create', 'open', 'save', 'rename', 'duplicate', 'trash', 'saveThumbnail']),
  photos: ns('photos', ['load', 'save', 'pick', 'prepare', 'pickFolder', 'writeExport', 'videoDir']),
  media: ns('media', ['pickFiles', 'pickFile', 'probe', 'exists', 'sfx', 'copyToProject', 'saveRecording', 'findInFolder', 'collect', 'importLut']),
  jobs: {
    ...ns('jobs', ['start', 'cancel']),
    onEvent: (listener: (event: JobEvent) => void) => {
      const handler = (_e: unknown, event: JobEvent) => listener(event)
      ipcRenderer.on(JOB_EVENT_CHANNEL, handler)
      return () => ipcRenderer.removeListener(JOB_EVENT_CHANNEL, handler)
    }
  },
  settings: ns('settings', ['get', 'set', 'secrets', 'setSecret']),
  components: ns('components', ['list', 'remove']),
  fonts: ns('fonts', ['list', 'import', 'remove']),
  templates: ns('templates', ['list', 'saveFrom', 'create', 'remove']),
  export: ns('export', ['pickOutput', 'encoders'])
}

contextBridge.exposeInMainWorld('maker', api)
// Drag & drop: File.path no longer exists in modern Electron.
contextBridge.exposeInMainWorld('makerFiles', { pathFor: (file: File) => webUtils.getPathForFile(file) })
