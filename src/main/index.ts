import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { createExportRunner, registerExportIpc } from './exporter'
import { registerIpc } from './ipc'
import { JobManager } from './jobs'
import { scoped } from './logger'
import { paths } from './paths'
import { handleMediaProtocol, registerMediaScheme } from './protocol'

const log = scoped('main')
const here = import.meta.dirname

process.on('uncaughtException', (err) => log.error('uncaught exception', err))
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err))

// Must precede the single-instance lock, which is keyed by the userData folder.
if (paths.dataRoot) app.setPath('userData', join(paths.dataRoot, 'userData'))

/**
 * Automated tests must never interrupt whoever is using the computer: the window lives far
 * off-screen, never takes focus, stays out of the taskbar/Alt+Tab and is muted. (A truly hidden
 * window makes Chromium throttle frames, which makes UI tests slow and flaky.) Throttling and
 * occlusion tracking are off so the off-screen page renders normally.
 */
const quietTest = process.env['MAKER_E2E'] === '1'
if (quietTest) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

registerMediaScheme()

/** Loads the renderer bundle; `hash` selects the view (editor or export runner). */
async function loadRenderer(win: BrowserWindow, hash = '') {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) await win.loadURL(`${devUrl}#${hash}`)
  else await win.loadFile(join(here, '../renderer/index.html'), { hash })
}

function hardenWindow(win: BrowserWindow) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? 'file://')) e.preventDefault()
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Maker',
    backgroundColor: '#161618',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#161618', symbolColor: '#e5e5ea', height: 40 },
    ...(quietTest ? { x: -20000, y: -20000, skipTaskbar: true, focusable: false } : {}),
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !quietTest
    }
  })
  hardenWindow(win)
  if (quietTest) win.webContents.setAudioMuted(true)
  win.once('ready-to-show', () => (quietTest ? win.showInactive() : win.show()))

  // A renderer crash must not lose work: the project is autosaved, so offer a reload.
  win.webContents.on('render-process-gone', async (_e, details) => {
    log.error(`editor renderer gone: ${details.reason}`)
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      message: 'Maker beklenmedik şekilde durdu / Maker stopped unexpectedly',
      detail: 'Projeniz otomatik kaydedildi. / Your project was autosaved.',
      buttons: ['Yeniden yükle / Reload', 'Kapat / Close']
    })
    if (response === 0) void loadRenderer(win)
    else win.close()
  })

  void loadRenderer(win)
  return win
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  handleMediaProtocol()
  const jobs = new JobManager(join(here, 'worker.js'))
  jobs.registerRunner(
    'export.render',
    createExportRunner((win) => loadRenderer(win, '/export'), join(here, '../preload/export.cjs'))
  )
  registerExportIpc()
  registerIpc(jobs)
  createMainWindow()
  log.info(`Maker ${app.getVersion()} started`)
})

app.on('window-all-closed', () => app.quit())
