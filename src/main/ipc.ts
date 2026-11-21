import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type { ApiHandlers } from '@shared/api'
import { FORMAT_EXTENSIONS } from '@shared/export'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, detectEncoders, probe, transcodeRecording } from './ffmpeg'
import { componentStatuses, removeComponent } from './components'
import type { JobManager } from './jobs'
import { scoped, write } from './logger'
import { paths } from './paths'
import * as projects from './projects'
import { getSettings, secretPresence, setSecret, setSettings } from './settings'
import { listSfx } from './sfx'
import { importFonts, listFonts, removeFont } from './fonts'
import * as photos from './photos'
import { existsSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'

const log = scoped('ipc')

const strip = (exts: string[]) => exts.map((e) => e.slice(1))
const FILTERS = {
  media: [{ name: 'Media', extensions: strip([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS]) }],
  audio: [{ name: 'Audio', extensions: strip([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]) }]
}

const focused = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

export function registerIpc(jobs: JobManager) {
  const handlers: ApiHandlers = {
    app: {
      info: async () => ({ version: app.getVersion(), platform: process.platform, projectsDir: paths.projectsDir(), logsDir: paths.logsDir() }),
      revealPath: async (path) => shell.showItemInFolder(path),
      openExternal: async (url) => {
        if (!/^https:\/\//.test(url)) throw new Error('Only https links can be opened')
        await shell.openExternal(url)
      },
      copyText: async (text) => clipboard.writeText(String(text).slice(0, 100_000)),
      log: async (level, scope, message) => write(level, `renderer:${scope}`, message)
    },
    projects: {
      list: projects.listProjects,
      create: projects.createProject,
      open: projects.openProject,
      save: projects.saveProject,
      rename: projects.renameProject,
      duplicate: projects.duplicateProject,
      trash: projects.trashProject,
      saveThumbnail: projects.saveThumbnail
    },
    media: {
      pickFiles: async (filter) => {
        const res = await dialog.showOpenDialog(focused(), { properties: ['openFile', 'multiSelections'], filters: FILTERS[filter] })
        return res.canceled ? [] : res.filePaths
      },
      pickFile: async (filter) => {
        const res = await dialog.showOpenDialog(focused(), { properties: ['openFile'], filters: FILTERS[filter] })
        return res.canceled ? null : (res.filePaths[0] ?? null)
      },
      probe: async (list) => Promise.all(list.map(probe)),
      exists: async (list) => list.map((p) => existsSync(p)),
      sfx: async () => listSfx(),
      copyToProject: async (projectId, path) => {
        // Only Maker's own resources may be copied this way.
        if (!resolve(path).startsWith(resolve(paths.sfxDir()) + sep)) throw new Error('Not a built-in file')
        const target = join(projects.projectMediaDir(projectId), basename(path))
        await mkdir(projects.projectMediaDir(projectId), { recursive: true })
        if (!existsSync(target)) await copyFile(path, target)
        return target
      },
      findInFolder: async (names) => {
        const res = await dialog.showOpenDialog(focused(), { properties: ['openDirectory'] })
        const root = res.canceled ? undefined : res.filePaths[0]
        if (!root) return {}
        const wanted = new Set(names.map((n) => String(n).toLowerCase()))
        const found: Record<string, string> = {}
        let visited = 0
        // Bounded walk: a few levels deep, skipping hidden and dependency folders.
        const walk = async (dir: string, depth: number) => {
          if (depth > 6 || visited > 50_000) return
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
          for (const e of entries) {
            visited++
            const full = join(dir, e.name)
            const key = e.name.toLowerCase()
            if (e.isDirectory()) {
              if (!e.name.startsWith('.') && e.name !== 'node_modules') await walk(full, depth + 1)
            } else if (wanted.has(key) && !found[key]) found[key] = full
          }
        }
        await walk(root, 0)
        return found
      },
      collect: async (projectId, files) => {
        // Only media this project already uses may be copied.
        const { project, dir: projectFolder } = await projects.loadProject(projectId)
        const known = new Set(Object.values(project.assets).map((a) => resolve(a.path.startsWith('./') ? join(projectFolder, a.path.slice(2)) : a.path).toLowerCase()))
        const dir = projects.projectMediaDir(projectId)
        await mkdir(dir, { recursive: true })
        const out: Record<string, string> = {}
        for (const src of files) {
          if (!isAbsolute(src) || !existsSync(src) || !known.has(resolve(src).toLowerCase())) continue
          if (resolve(src).toLowerCase().startsWith(resolve(projectFolder).toLowerCase() + sep)) continue
          const ext = extname(src)
          const stem = basename(src, ext)
          let target = join(dir, basename(src))
          for (let i = 1; existsSync(target); i++) target = join(dir, `${stem}-${i}${ext}`)
          await copyFile(src, target)
          out[src] = target
        }
        return out
      },
      saveRecording: async (projectId, data) => {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)
        if (bytes.byteLength > 1024 ** 3) throw new Error('Recording is too large')
        const dir = projects.projectMediaDir(projectId)
        await mkdir(dir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
        const raw = join(dir, `voiceover-${stamp}.webm`)
        const target = join(dir, `voiceover-${stamp}.m4a`)
        await writeFile(raw, bytes)
        try {
          await transcodeRecording(raw, target)
        } finally {
          await rm(raw, { force: true })
        }
        return target
      },
      importLut: async (projectId) => {
        const res = await dialog.showOpenDialog(focused(), { properties: ['openFile'], filters: [{ name: 'LUT (.cube)', extensions: ['cube'] }] })
        const source = res.canceled ? undefined : res.filePaths[0]
        if (!source) return null
        const dir = projects.projectMediaDir(projectId)
        await mkdir(dir, { recursive: true })
        const target = join(dir, `lut-${Date.now().toString(36)}-${basename(source)}`)
        await copyFile(source, target)
        return { path: target, name: basename(source).replace(/\.cube$/i, '') }
      }
    },
    jobs: {
      start: async (kind, input, label) => jobs.start(kind, input, label),
      cancel: async (jobId) => jobs.cancel(jobId)
    },
    settings: {
      get: async () => getSettings(),
      set: setSettings,
      secrets: async () => secretPresence(),
      setSecret
    },
    components: {
      list: async () => componentStatuses(),
      remove: removeComponent
    },
    templates: {
      list: projects.listTemplates,
      saveFrom: projects.saveAsTemplate,
      create: projects.createFromTemplate,
      remove: projects.removeTemplate
    },
    fonts: {
      list: listFonts,
      import: async () => importFonts(focused()),
      remove: removeFont
    },
    photos: {
      load: photos.loadCatalog,
      save: photos.saveCatalog,
      pick: () => photos.pickPhotos(focused()),
      prepare: (files) => photos.preparePhotos(files.map(String)),
      pickFolder: () => photos.pickFolder(focused()),
      writeExport: (dir, name, data) => photos.writeExport(String(dir), String(name), data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer)),
      videoDir: photos.videoDir
    },
    export: {
      pickOutput: async (defaultName, format = 'mp4', ext) => {
        const settings = getSettings()
        const dir = settings.lastExportDir || app.getPath('videos')
        const allowed = FORMAT_EXTENSIONS[format] ?? ['mp4']
        const chosen = ext && allowed.includes(ext) ? ext : allowed[0]
        const res = await dialog.showSaveDialog(focused(), {
          defaultPath: join(dir, defaultName.replace(/[\\/:*?"<>|]/g, '_') + '.' + chosen),
          filters: [{ name: chosen.toUpperCase(), extensions: [chosen] }]
        })
        if (res.canceled || !res.filePath) return null
        await setSettings({ lastExportDir: join(res.filePath, '..') })
        return res.filePath
      },
      encoders: detectEncoders
    }
  }

  for (const [ns, methods] of Object.entries(handlers)) {
    for (const [name, fn] of Object.entries(methods as Record<string, (...args: unknown[]) => Promise<unknown>>)) {
      const channel = `${ns}:${name}`
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        try {
          return await fn(...args)
        } catch (err) {
          log.error(channel, err)
          throw err
        }
      })
    }
  }
}
