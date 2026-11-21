import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, SecretName, Settings } from '@shared/settings'
import { writeFileAtomic } from './fsx'
import { scoped } from './logger'
import { paths } from './paths'

const log = scoped('settings')
const settingsFile = () => join(paths.userData(), 'settings.json')
const secretsFile = () => join(paths.userData(), 'secrets.json')

let current: Settings | null = null

function readJson(path: string): unknown {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  } catch (err) {
    log.error(`could not read ${path}`, err)
    return null
  }
}

export function getSettings(): Settings {
  if (current) return current
  const raw = readJson(settingsFile()) as Partial<Settings> | null
  // Merge over defaults (one level deep) so new settings keys get sane values after updates.
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const [key, value] of Object.entries(raw ?? {})) {
    const base = merged[key]
    const nested = base && typeof base === 'object' && !Array.isArray(base) && value && typeof value === 'object' && !Array.isArray(value)
    merged[key] = nested ? { ...base, ...value } : value
  }
  const parsed = Settings.safeParse(merged)
  current = parsed.success ? parsed.data : DEFAULT_SETTINGS
  if (!parsed.success) log.warn('settings file invalid, using defaults')
  return current
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = Settings.parse({ ...getSettings(), ...patch })
  mkdirSync(paths.userData(), { recursive: true })
  await writeFileAtomic(settingsFile(), JSON.stringify(next, null, 2))
  current = next
  return next
}

type SecretStore = Partial<Record<SecretName, string>>

function readSecrets(): SecretStore {
  return (readJson(secretsFile()) as SecretStore | null) ?? {}
}

export function getSecret(name: SecretName): string | undefined {
  const encoded = readSecrets()[name]
  if (!encoded) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch (err) {
    log.error(`could not decrypt secret ${name}`, err)
    return undefined
  }
}

export function secretPresence(): Record<SecretName, boolean> {
  const store = readSecrets()
  return Object.fromEntries(SecretName.options.map((n) => [n, !!store[n]])) as Record<SecretName, boolean>
}

export async function setSecret(name: SecretName, value: string | null): Promise<void> {
  SecretName.parse(name)
  const store = readSecrets()
  if (value && value.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system')
    store[name] = safeStorage.encryptString(value.trim()).toString('base64')
  } else {
    delete store[name]
  }
  mkdirSync(paths.userData(), { recursive: true })
  await writeFileAtomic(secretsFile(), JSON.stringify(store))
}
