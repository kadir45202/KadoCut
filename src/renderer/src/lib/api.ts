import { toMediaUrl } from '@shared/api'

/** Typed IPC API exposed by the preload (see src/preload/index.ts). */
export const api = window.maker

export const mediaUrl = toMediaUrl

export function pathForFile(file: File): string {
  return window.makerFiles.pathFor(file)
}

/** Renderer log lines go to the shared log file (Settings > Diagnostics). */
export const log = {
  info: (scope: string, msg: string) => void api.app.log('info', scope, msg).catch(() => {}),
  warn: (scope: string, msg: string) => void api.app.log('warn', scope, msg).catch(() => {}),
  error: (scope: string, msg: string, err?: unknown) =>
    void api.app
      .log('error', scope, err ? `${msg}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` : msg)
      .catch(() => {})
}
