import { dialog, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { CONVERTED_PHOTO_EXTENSIONS, PHOTO_EXTENSIONS, PhotoCatalog, emptyCatalog, upgradeCatalog, type PhotoProbe } from '@shared/photo'
import { writeFileAtomic } from './fsx'
import { scoped } from './logger'
import { paths } from './paths'

const run = promisify(execFile)
const log = scoped('photos')

const catalogFile = () => join(paths.photosDir(), 'catalog.json')

/** The photo catalog; a damaged file is set aside (never deleted) and an empty catalog starts. */
export async function loadCatalog(): Promise<PhotoCatalog> {
  const file = catalogFile()
  if (!existsSync(file)) return emptyCatalog()
  try {
    const parsed = PhotoCatalog.safeParse(upgradeCatalog(JSON.parse(await readFile(file, 'utf8'))))
    if (parsed.success) return parsed.data
    log.warn(`catalog invalid: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`)
  } catch (err) {
    log.warn(`catalog unreadable: ${String(err)}`)
  }
  await rename(file, join(paths.photosDir(), `catalog.damaged-${Date.now()}.json`)).catch(() => {})
  return emptyCatalog()
}

export async function saveCatalog(catalog: unknown): Promise<void> {
  const valid = PhotoCatalog.parse(catalog)
  await mkdir(paths.photosDir(), { recursive: true })
  await writeFileAtomic(catalogFile(), JSON.stringify(valid))
}

export async function pickPhotos(win: BrowserWindow | undefined): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Photos', extensions: PHOTO_EXTENSIONS.map((e) => e.slice(1)) }]
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled ? [] : res.filePaths
}

/** Checks picked files; TIFF / HEIC get a PNG copy in the cache that Chromium can draw. */
export async function preparePhotos(files: string[]): Promise<PhotoProbe[]> {
  const out: PhotoProbe[] = []
  for (const path of files) {
    const ext = extname(path).toLowerCase()
    if (!isAbsolute(path) || !PHOTO_EXTENSIONS.includes(ext) || !existsSync(path)) {
      out.push({ ok: false, path, error: 'Unsupported file' })
      continue
    }
    let preview = ''
    if (CONVERTED_PHOTO_EXTENSIONS.includes(ext)) {
      const dir = join(paths.cacheDir(), 'photos')
      await mkdir(dir, { recursive: true })
      preview = join(dir, `${createHash('sha1').update(path).digest('hex').slice(0, 16)}.png`)
      try {
        if (!existsSync(preview)) {
          await run(paths.ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-frames:v', '1', '-pix_fmt', 'rgb24', preview], {
            timeout: 120_000,
            windowsHide: true
          })
        }
      } catch (err) {
        log.warn(`cannot convert ${path}: ${String(err)}`)
        out.push({ ok: false, path, error: 'This file could not be read' })
        continue
      }
    }
    // Pixel size comes from the renderer's decode (it applies EXIF orientation).
    out.push({ ok: true, path, preview, name: basename(path), width: 1, height: 1 })
  }
  return out
}

export async function pickFolder(win: BrowserWindow | undefined): Promise<string | null> {
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return res.canceled ? null : (res.filePaths[0] ?? null)
}

/** A fresh folder (Photos/Video/<date-time>) for photos rendered into a video project. */
export async function videoDir(): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
  let dir = join(paths.photosDir(), 'Video', stamp)
  for (let i = 1; existsSync(dir); i++) dir = join(paths.photosDir(), 'Video', `${stamp}-${i}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Writes an exported image into `dir`, never overwriting: name-1.jpg, name-2.jpg… */
export async function writeExport(dir: string, name: string, data: Uint8Array): Promise<string> {
  const ext = extname(name).toLowerCase()
  if (!isAbsolute(dir) || !['.jpg', '.jpeg', '.png'].includes(ext)) throw new Error('Invalid export target')
  const stem = basename(name, extname(name)).replace(/[\\/:*?"<>|]/g, '_') || 'photo'
  await mkdir(dir, { recursive: true })
  let target = join(dir, `${stem}${ext}`)
  for (let i = 1; existsSync(target); i++) target = join(dir, `${stem}-${i}${ext}`)
  await writeFile(target, data)
  return target
}
