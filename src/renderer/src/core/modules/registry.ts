import { create } from 'zustand'
import { translate } from '@renderer/i18n'
import { log } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { useSettings } from '../store/settings'
import { formatCombo } from './shortcuts'
import type { CommandDef, ModuleDef } from './types'

export type ModuleStatus = 'active' | 'disabled' | 'failed'

export interface ModuleRecord {
  id: string
  def?: ModuleDef
  status: ModuleStatus
  /** Load error, or the last runtime error. */
  error?: string
  errorCount: number
}

export const useModules = create<{ records: Record<string, ModuleRecord>; ready: boolean }>(() => ({ records: {}, ready: false }))

const lastToast = new Map<string, number>()

/** Records a runtime error of a module and notifies the user (throttled per module). */
export function reportModuleError(moduleId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  log.error(`module:${moduleId}`, 'runtime error', err)
  useModules.setState((s) => {
    const rec = s.records[moduleId]
    if (!rec) return s
    return { records: { ...s.records, [moduleId]: { ...rec, error: message, errorCount: rec.errorCount + 1 } } }
  })
  const now = Date.now()
  if (now - (lastToast.get(moduleId) ?? 0) > 4000) {
    lastToast.set(moduleId, now)
    const name = useModules.getState().records[moduleId]?.def?.name() ?? moduleId
    toast.error(translate('module.error', { name }), message)
  }
}

function isModuleDef(x: unknown): x is ModuleDef {
  return !!x && typeof x === 'object' && typeof (x as ModuleDef).id === 'string' && typeof (x as ModuleDef).name === 'function'
}

/**
 * Loads every module folder independently. A module that throws while loading is marked
 * failed and skipped; all others keep working.
 */
export async function loadModules(disabled: readonly string[]) {
  const loaders = import.meta.glob<{ default: unknown }>('../../modules/*/index.{ts,tsx}')
  const records: Record<string, ModuleRecord> = {}
  await Promise.all(
    Object.entries(loaders).map(async ([path, load]) => {
      const folder = /modules\/([^/]+)\//.exec(path)?.[1] ?? path
      try {
        const def = (await load()).default
        if (!isModuleDef(def)) throw new Error('Module does not export a valid definition')
        records[def.id] = { id: def.id, def, status: !def.core && disabled.includes(def.id) ? 'disabled' : 'active', errorCount: 0 }
      } catch (err) {
        log.error(`module:${folder}`, 'failed to load', err)
        records[folder] = { id: folder, status: 'failed', error: err instanceof Error ? err.message : String(err), errorCount: 1 }
      }
    })
  )
  useModules.setState({ records, ready: true })
}

export function setModuleEnabled(id: string, enabled: boolean) {
  useModules.setState((s) => {
    const rec = s.records[id]
    if (!rec?.def || rec.def.core) return s
    return { records: { ...s.records, [id]: { ...rec, status: enabled ? 'active' : 'disabled' } } }
  })
}

/** Active module definitions in a stable order. */
export function activeModules(records: Record<string, ModuleRecord>): ModuleDef[] {
  return Object.values(records)
    .filter((r) => r.status === 'active' && r.def)
    .map((r) => r.def!)
    .sort((a, b) => a.id.localeCompare(b.id))
}

export interface RegisteredCommand extends CommandDef {
  moduleId: string
}

/** Every active command, with the user's key bindings applied over the module defaults. */
export function allCommands(records: Record<string, ModuleRecord>): Map<string, RegisteredCommand> {
  const overrides = useSettings.getState().settings.shortcuts
  const map = new Map<string, RegisteredCommand>()
  for (const def of activeModules(records)) {
    for (const c of def.commands ?? []) {
      const keys = overrides[c.id]
      map.set(c.id, keys ? { ...c, keys, keyLabel: keys[0] ? formatCombo(keys[0]) : undefined, moduleId: def.id } : { ...c, moduleId: def.id })
    }
  }
  return map
}

export function findCommand(id: string): RegisteredCommand | undefined {
  return allCommands(useModules.getState().records).get(id)
}

/** Executes a command with error isolation. Returns false if it was disabled or failed. */
export async function runCommand(id: string): Promise<boolean> {
  const cmd = findCommand(id)
  if (!cmd) return false
  try {
    if (cmd.enabled && !cmd.enabled()) return false
    await cmd.run()
    return true
  } catch (err) {
    reportModuleError(cmd.moduleId, err)
    return false
  }
}

export function commandEnabled(cmd: CommandDef): boolean {
  try {
    return cmd.enabled ? cmd.enabled() : true
  } catch {
    return false
  }
}
