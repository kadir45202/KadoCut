import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, stat, unlink, copyFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { toMediaUrl, type OpenedProject } from '@shared/api'
import { createEmptyProject } from '@shared/project/defaults'
import { migrateProject } from '@shared/project/migrate'
import { Project, type AspectPreset, type ProjectSummary } from '@shared/project/schema'
import { writeFileAtomic } from './fsx'
import { scoped } from './logger'
import { paths } from './paths'

const log = scoped('projects')

const PROJECT_FILE = 'project.json'
const THUMB_FILE = 'thumbnail.jpg'
const BACKUP_DIR = 'backups'
const BACKUP_INTERVAL_MS = 10 * 60 * 1000
const BACKUP_KEEP = 20

const ID_PATTERN = /^[a-z0-9-]{8,64}$/

export function projectDir(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid project id: ${id}`)
  return join(paths.projectsDir(), id)
}

export const projectMediaDir = (id: string) => join(projectDir(id), 'media')

/** Absolute paths inside the project folder are stored relative so projects can be moved. */
function toStored(project: Project, dir: string): Project {
  const assets = Object.fromEntries(
    Object.entries(project.assets).map(([id, a]) => {
      const inside = a.path.startsWith(dir + sep)
      return [id, inside ? { ...a, path: './' + relative(dir, a.path).split(sep).join('/') } : a]
    })
  )
  return { ...project, assets }
}

function fromStored(project: Project, dir: string): Project {
  const assets = Object.fromEntries(
    Object.entries(project.assets).map(([id, a]) => [id, a.path.startsWith('./') ? { ...a, path: join(dir, a.path.slice(2)) } : a])
  )
  return { ...project, assets }
}

async function readProjectFile(path: string): Promise<Project | null> {
  if (!existsSync(path)) return null
  return migrateProject(JSON.parse(await readFile(path, 'utf8')))
}

/** Loads project.json; if it is damaged, falls back to the newest readable backup. */
async function loadLatest(id: string): Promise<{ project: Project; recovered: boolean }> {
  const dir = projectDir(id)
  try {
    const saved = await readProjectFile(join(dir, PROJECT_FILE))
    if (saved) return { project: fromStored(saved, dir), recovered: false }
  } catch (err) {
    log.error(`project.json unreadable for ${id}`, err)
  }

  // Last resort: newest readable backup.
  const backups = await listBackups(dir)
  for (const file of backups.reverse()) {
    try {
      const p = await readProjectFile(join(dir, BACKUP_DIR, file))
      if (p) return { project: fromStored(p, dir), recovered: true }
    } catch {
      // try older backup
    }
  }
  throw new Error('Project file is missing or damaged')
}

async function listBackups(dir: string): Promise<string[]> {
  try {
    return (await readdir(join(dir, BACKUP_DIR))).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return []
  }
}

function summarize(project: Project, dir: string, thumbMtime: number | null): ProjectSummary {
  const clips = Object.values(project.clips)
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    duration: clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0),
    aspect: project.settings.aspect,
    width: project.settings.width,
    height: project.settings.height,
    clipCount: clips.length,
    dir,
    thumbnail: thumbMtime ? `${toMediaUrl(join(dir, THUMB_FILE))}?v=${thumbMtime}` : null
  }
}

async function thumbMtime(dir: string): Promise<number | null> {
  try {
    return Math.round((await stat(join(dir, THUMB_FILE))).mtimeMs)
  } catch {
    return null
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await mkdir(paths.projectsDir(), { recursive: true })
  const entries = await readdir(paths.projectsDir(), { withFileTypes: true })
  const result: ProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue
    try {
      const dir = projectDir(entry.name)
      const { project } = await loadLatest(entry.name)
      result.push(summarize(project, dir, await thumbMtime(dir)))
    } catch (err) {
      log.warn(`skipping unreadable project ${entry.name}: ${String(err)}`)
    }
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function createProject(input: { name: string; aspect: AspectPreset; fps: number }): Promise<OpenedProject> {
  const id = randomUUID()
  const dir = projectDir(id)
  await mkdir(join(dir, 'media'), { recursive: true })
  const project = createEmptyProject({ id, name: input.name.trim() || 'Untitled', aspect: input.aspect, fps: input.fps })
  await writeFileAtomic(join(dir, PROJECT_FILE), JSON.stringify(project, null, 2))
  log.info(`created ${id}`)
  return { project, dir, missing: [], recovered: false }
}

export async function openProject(id: string): Promise<OpenedProject> {
  const dir = projectDir(id)
  const { project, recovered } = await loadLatest(id)
  const missing = Object.values(project.assets)
    .filter((a) => !existsSync(a.path))
    .map((a) => a.id)
  await mkdir(join(dir, 'media'), { recursive: true })
  log.info(`opened ${id}${recovered ? ' (restored from backup)' : ''}${missing.length ? `, ${missing.length} missing` : ''}`)
  return { project, dir, missing, recovered }
}

/** Loads the current saved state for export (validated, absolute paths). */
export async function loadProject(id: string): Promise<{ project: Project; dir: string }> {
  return { project: (await loadLatest(id)).project, dir: projectDir(id) }
}

async function maybeBackup(dir: string) {
  const current = join(dir, PROJECT_FILE)
  if (!existsSync(current)) return
  const backups = await listBackups(dir)
  const last = backups.at(-1)
  const lastTime = last ? Number(last.replace('.json', '')) : 0
  if (Date.now() - lastTime < BACKUP_INTERVAL_MS) return
  await mkdir(join(dir, BACKUP_DIR), { recursive: true })
  await copyFile(current, join(dir, BACKUP_DIR, `${Date.now()}.json`))
  for (const old of backups.slice(0, Math.max(0, backups.length + 1 - BACKUP_KEEP))) {
    await unlink(join(dir, BACKUP_DIR, old)).catch(() => {})
  }
}

export async function saveProject(input: Project): Promise<{ savedAt: number }> {
  // Never write a project that does not pass validation.
  const project = Project.parse(input)
  const dir = projectDir(project.id)
  await mkdir(dir, { recursive: true })
  await maybeBackup(dir)
  await writeFileAtomic(join(dir, PROJECT_FILE), JSON.stringify(toStored(project, dir), null, 2))
  return { savedAt: Date.now() }
}

export async function renameProject(id: string, name: string): Promise<void> {
  const { project } = await loadLatest(id)
  await saveProject({ ...project, name: name.trim() || project.name, updatedAt: Date.now() })
}

export async function duplicateProject(id: string, name: string): Promise<ProjectSummary> {
  const src = projectDir(id)
  const newId = randomUUID()
  const dst = projectDir(newId)
  await cp(src, dst, { recursive: true, filter: (p) => !p.includes(`${sep}${BACKUP_DIR}`) })
  const { project } = await loadLatest(newId)
  const now = Date.now()
  // Paths inside the old folder must point into the copy.
  const assets = Object.fromEntries(
    Object.entries(project.assets).map(([aid, a]) => [aid, a.path.startsWith(src + sep) ? { ...a, path: dst + a.path.slice(src.length) } : a])
  )
  const copy = { ...project, id: newId, name, createdAt: now, updatedAt: now, assets }
  await saveProject(copy)
  return summarize(copy, dst, await thumbMtime(dst))
}

/** Moves the project folder to the Recycle Bin (recoverable, never a hard delete). */
export async function trashProject(id: string): Promise<void> {
  const dir = projectDir(id)
  try {
    await shell.trashItem(dir)
  } catch (err) {
    log.error(`trash failed for ${id}`, err)
    throw new Error('Could not move the project to the Recycle Bin')
  }
}

export async function saveThumbnail(id: string, dataUrl: string): Promise<void> {
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl)
  if (!match) throw new Error('Thumbnail must be a JPEG data URL')
  await writeFileAtomic(join(projectDir(id), THUMB_FILE), Buffer.from(match[1], 'base64'))
}

// ---------------------------------------------------------------- templates

/** A template is a project folder kept under <userData>/templates (media copied with it). */
function templateDir(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid template id: ${id}`)
  return join(paths.templatesDir(), id)
}

/** Points asset paths that lived inside `from` into `to`. */
function rebase(project: Project, from: string, to: string): Project {
  const assets = Object.fromEntries(
    Object.entries(project.assets).map(([aid, a]) => [aid, a.path.startsWith(from + sep) ? { ...a, path: to + a.path.slice(from.length) } : a])
  )
  return { ...project, assets }
}

async function copyFolder(project: Project, from: string, to: string, id: string, name: string): Promise<Project> {
  await cp(from, to, { recursive: true, filter: (p) => !p.includes(`${sep}${BACKUP_DIR}`) })
  const now = Date.now()
  const copy = { ...rebase(project, from, to), id, name, createdAt: now, updatedAt: now }
  await writeFileAtomic(join(to, PROJECT_FILE), JSON.stringify(toStored(copy, to), null, 2))
  return copy
}

export async function listTemplates(): Promise<ProjectSummary[]> {
  await mkdir(paths.templatesDir(), { recursive: true })
  const result: ProjectSummary[] = []
  for (const entry of await readdir(paths.templatesDir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue
    try {
      const dir = templateDir(entry.name)
      const saved = await readProjectFile(join(dir, PROJECT_FILE))
      if (saved) result.push(summarize(fromStored(saved, dir), dir, await thumbMtime(dir)))
    } catch (err) {
      log.warn(`skipping unreadable template ${entry.name}: ${String(err)}`)
    }
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveAsTemplate(projectId: string, name: string): Promise<ProjectSummary> {
  const { project } = await loadLatest(projectId)
  const id = randomUUID()
  const dir = templateDir(id)
  const copy = await copyFolder(project, projectDir(projectId), dir, id, name)
  return summarize(copy, dir, await thumbMtime(dir))
}

/** New project from a template: the template folder (with its media) is copied. */
export async function createFromTemplate(templateId: string, name: string): Promise<OpenedProject> {
  const src = templateDir(templateId)
  const saved = await readProjectFile(join(src, PROJECT_FILE))
  if (!saved) throw new Error('Template is missing')
  const id = randomUUID()
  await copyFolder(fromStored(saved, src), src, projectDir(id), id, name)
  return openProject(id)
}

export async function removeTemplate(id: string): Promise<void> {
  await shell.trashItem(templateDir(id))
}
