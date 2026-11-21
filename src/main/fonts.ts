import { dialog, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
import type { CustomFont } from '@shared/api'
import { paths } from './paths'

const FONT_EXT = ['.ttf', '.otf', '.woff', '.woff2']

/** The family name a user font is registered under: its file name. */
const toFont = (path: string): CustomFont => ({ family: basename(path, extname(path)), path })

/** Fonts the user added; copied into <userData>/fonts so projects keep working. */
export async function listFonts(): Promise<CustomFont[]> {
  const dir = paths.fontsDir()
  if (!existsSync(dir)) return []
  return (await readdir(dir))
    .filter((f) => FONT_EXT.includes(extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .map((f) => toFont(join(dir, f)))
}

export async function importFonts(win: BrowserWindow | undefined): Promise<CustomFont[]> {
  const options = { properties: ['openFile', 'multiSelections'] as ('openFile' | 'multiSelections')[], filters: [{ name: 'Font', extensions: FONT_EXT.map((e) => e.slice(1)) }] }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  if (res.canceled) return []
  await mkdir(paths.fontsDir(), { recursive: true })
  const added: CustomFont[] = []
  for (const source of res.filePaths) {
    const target = join(paths.fontsDir(), basename(source))
    if (!existsSync(target)) await copyFile(source, target)
    added.push(toFont(target))
  }
  return added
}

export async function removeFont(path: string): Promise<void> {
  if (!resolve(path).startsWith(resolve(paths.fontsDir()) + sep)) throw new Error('Not a Maker font')
  await unlink(path)
}
