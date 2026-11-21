import { produce, type Draft } from 'immer'
import { create } from 'zustand'
import type { OpenedProject } from '@shared/api'
import type { Project } from '@shared/project/schema'
import { translate } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { validateProject } from '../project/invariants'
import { normalize } from '../project/timeline'

const HISTORY_LIMIT = 200
const SAVE_DELAY_MS = 1200

interface HistoryEntry {
  project: Project
  label: string
}

interface ProjectState {
  project: Project | null
  dir: string
  /** Asset ids whose files are missing on disk. */
  missing: string[]
  past: HistoryEntry[]
  future: HistoryEntry[]
  saving: boolean
  savedAt: number
  saveError: string | null
}

export const useProject = create<ProjectState>(() => ({
  project: null,
  dir: '',
  missing: [],
  past: [],
  future: [],
  saving: false,
  savedAt: 0,
  saveError: null
}))

/** The current project; only call where a project is guaranteed to be open. */
export function currentProject(): Project {
  const p = useProject.getState().project
  if (!p) throw new Error('No project open')
  return p
}

export type Recipe = (draft: Draft<Project>) => void

let gestureBase: Project | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

function reportRejected(source: string, label: string, reason: string) {
  log.warn(`edit:${source}`, `rejected "${label}": ${reason}`)
  toast.error(translate('edit.rejected'), translate('edit.rejectedDetail', { action: label }))
}

/** Runs recipe + normalization; returns the next state, the same state (no-op) or an error. */
function compute(base: Project, recipe: Recipe): { next: Project } | { error: string } {
  try {
    const next = produce(base, (draft) => {
      recipe(draft)
      normalize(draft as Project)
    })
    if (next === base) return { next }
    const error = validateProject(next)
    if (error) return { error }
    return { next: produce(next, (d) => void (d.updatedAt = Date.now())) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

function commit(next: Project, prev: Project, label: string) {
  const { past } = useProject.getState()
  useProject.setState({ project: next, past: [...past, { project: prev, label }].slice(-HISTORY_LIMIT), future: [] })
  scheduleSave()
}

export const projectActions = {
  load(opened: OpenedProject) {
    gestureBase = null
    useProject.setState({ project: opened.project, dir: opened.dir, missing: opened.missing, past: [], future: [], savedAt: Date.now(), saveError: null })
  },

  async close() {
    await projectActions.flush()
    gestureBase = null
    useProject.setState({ project: null, dir: '', missing: [], past: [], future: [] })
  },

  /**
   * Applies an edit atomically. Invalid results are rejected and leave the project untouched,
   * so a faulty tool can never corrupt the project. `source` names the module for diagnostics.
   */
  apply(label: string, recipe: Recipe, source = 'core'): boolean {
    const base = useProject.getState().project
    if (!base) return false
    if (gestureBase) projectActions.end(label, source)
    const result = compute(base, recipe)
    if ('error' in result) {
      reportRejected(source, label, result.error)
      return false
    }
    if (result.next !== base) commit(result.next, base, label)
    return true
  },

  /** True while a drag/scrub gesture is open. */
  inGesture(): boolean {
    return gestureBase !== null
  },

  /** Starts a continuous edit (drag/scrub); changes until end() form one undo step. */
  begin() {
    gestureBase ??= useProject.getState().project
  },

  /** Live update during a gesture: no history entry, no validation until end(). */
  transient(recipe: Recipe) {
    const base = useProject.getState().project
    if (!base) return
    if (!gestureBase) gestureBase = base
    try {
      const next = produce(base, (draft) => {
        recipe(draft)
        normalize(draft as Project)
      })
      if (next !== base) useProject.setState({ project: next })
    } catch (err) {
      log.warn('edit', `transient update failed: ${String(err)}`)
    }
  },

  end(label: string, source = 'core') {
    const base = gestureBase
    gestureBase = null
    const current = useProject.getState().project
    if (!base || !current || base === current) return
    const error = validateProject(current)
    if (error) {
      useProject.setState({ project: base })
      reportRejected(source, label, error)
      return
    }
    commit(produce(current, (d) => void (d.updatedAt = Date.now())), base, label)
  },

  /** Reverts an in-progress gesture (e.g. Escape while dragging). */
  cancelGesture() {
    if (gestureBase) useProject.setState({ project: gestureBase })
    gestureBase = null
  },

  undo() {
    const { past, future, project } = useProject.getState()
    const entry = past.at(-1)
    if (!entry || !project) return
    useProject.setState({ project: entry.project, past: past.slice(0, -1), future: [{ project, label: entry.label }, ...future] })
    scheduleSave()
  },

  redo() {
    const { past, future, project } = useProject.getState()
    const entry = future[0]
    if (!entry || !project) return
    useProject.setState({ project: entry.project, past: [...past, { project, label: entry.label }], future: future.slice(1) })
    scheduleSave()
  },

  /** Moves through the history: negative = undo that many steps, positive = redo. */
  jump(steps: number) {
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps < 0) projectActions.undo()
      else projectActions.redo()
    }
  },

  /** Writes pending changes now (before closing, exporting...). */
  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await save()
  },

  setMissing(missing: string[]) {
    useProject.setState({ missing })
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void save()
  }, SAVE_DELAY_MS)
}

let saving: Promise<void> | null = null
let lastSaved: Project | null = null

async function save(): Promise<void> {
  if (saving) await saving
  const project = useProject.getState().project
  if (!project || project === lastSaved) return
  useProject.setState({ saving: true })
  saving = api.projects
    .save(project)
    .then(({ savedAt }) => {
      lastSaved = project
      useProject.setState({ savedAt, saveError: null })
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log.error('save', 'project save failed', err)
      useProject.setState({ saveError: message })
      toast.error(translate('save.failed'), message)
    })
    .finally(() => {
      saving = null
      useProject.setState({ saving: false })
    })
  await saving
}
