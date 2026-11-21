import { BrowserWindow, ipcMain } from 'electron'
import { isAbsolute } from 'node:path'
import type { ExportSession } from '@shared/api'
import { FORMAT_EXTENSIONS, type ExportRequest } from '@shared/export'
import { detectEncoders } from './ffmpeg'
import { jobError, type CustomRunner } from './jobs'
import { scoped } from './logger'
import { paths } from './paths'
import { loadProject } from './projects'

const log = scoped('export')

interface Session {
  info: ExportSession
  pids: Set<number>
  progress(p: number, message?: string): void
  resolve(output: unknown): void
  reject(err: Error): void
}

const sessions = new Map<number, Session>()

function killPid(pid: number) {
  try {
    process.kill(pid)
  } catch {
    // already exited
  }
}

/** IPC used only by the hidden export window (see src/preload/export.ts). */
export function registerExportIpc() {
  ipcMain.handle('export:session', (e) => {
    const s = sessions.get(e.sender.id)
    if (!s) throw new Error('No export session for this window')
    return s.info
  })
  ipcMain.on('export:progress', (e, p: number, msg?: string) => sessions.get(e.sender.id)?.progress(p, msg))
  ipcMain.on('export:pid', (e, pid: number) => sessions.get(e.sender.id)?.pids.add(pid))
  ipcMain.on('export:done', (e, output: unknown) => sessions.get(e.sender.id)?.resolve(output))
  ipcMain.on('export:fail', (e, message: string) => sessions.get(e.sender.id)?.reject(jobError('failed', message)))
}

function validate(req: ExportRequest) {
  const okInt = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max
  const ext = req.outputPath.toLowerCase().split('.').pop() ?? ''
  if (!isAbsolute(req.outputPath) || !FORMAT_EXTENSIONS[req.format]?.includes(ext)) throw jobError('failed', 'Invalid output path')
  if (req.range && !(req.range.start >= 0 && req.range.end > req.range.start)) throw jobError('failed', 'Invalid range')
  if (!okInt(req.width, 16, 8192) || !okInt(req.height, 16, 8192)) throw jobError('failed', 'Invalid resolution')
  if (req.width % 2 || req.height % 2) throw jobError('failed', 'Resolution must be even')
  if (!(req.fps >= 1 && req.fps <= 120) || !(req.bitrate > 0 && req.bitrate <= 200)) throw jobError('failed', 'Invalid export settings')
}

/**
 * Export renders in a hidden window running the same compositor as the preview (WYSIWYG).
 * If that window crashes, only the export fails; the editor keeps running.
 */
export function createExportRunner(load: (win: BrowserWindow) => Promise<void>, preloadPath: string): CustomRunner {
  return async (input, ctx) => {
    const request = input as ExportRequest
    validate(request)
    const { project, dir } = await loadProject(request.projectId)
    const encoders = await detectEncoders()
    const list = encoders[request.codec]
    const encoder = request.hardware ? list[0] : list[list.length - 1]
    log.info(`start ${request.width}x${request.height}@${request.fps} ${encoder} -> ${request.outputPath}`)

    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      webPreferences: { preload: preloadPath, sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
    })
    const id = win.webContents.id
    let session: Session | undefined

    const cleanup = () => {
      for (const pid of session?.pids ?? []) killPid(pid)
      sessions.delete(id)
      if (!win.isDestroyed()) win.destroy()
    }

    try {
      return await new Promise<unknown>((resolve, reject) => {
        session = {
          info: { jobId: ctx.jobId, request, project, projectDir: dir, encoder, ffmpeg: paths.ffmpeg() },
          pids: new Set(),
          progress: ctx.progress,
          resolve,
          reject
        }
        sessions.set(id, session)
        win.webContents.on('render-process-gone', (_e, details) =>
          reject(jobError('crashed', `Export renderer stopped (${details.reason})`))
        )
        ctx.signal.addEventListener('abort', () => {
          if (!win.isDestroyed()) win.webContents.send('export:cancel')
          reject(jobError('cancelled', 'Cancelled'))
        })
        load(win).catch(reject)
      })
    } finally {
      // Let the window stop its encoders before we force-kill anything left over.
      setTimeout(cleanup, 1500)
    }
  }
}
