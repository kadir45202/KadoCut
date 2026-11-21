import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './paths'

type Level = 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024
let logFile: string | null = null

function file(): string {
  if (!logFile) {
    mkdirSync(paths.logsDir(), { recursive: true })
    logFile = join(paths.logsDir(), 'maker.log')
  }
  return logFile
}

function rotateIfNeeded(path: string) {
  try {
    if (statSync(path).size > MAX_BYTES) renameSync(path, path.replace(/\.log$/, '.1.log'))
  } catch {
    // File does not exist yet.
  }
}

export function write(level: Level, scope: string, message: string) {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${message}\n`
  if (level === 'error') console.error(line.trimEnd())
  else console.log(line.trimEnd())
  try {
    const path = file()
    rotateIfNeeded(path)
    appendFileSync(path, line)
  } catch {
    // Logging must never crash the app.
  }
}

export function scoped(scope: string) {
  return {
    info: (msg: string) => write('info', scope, msg),
    warn: (msg: string) => write('warn', scope, msg),
    error: (msg: string, err?: unknown) =>
      write('error', scope, err ? `${msg}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` : msg)
  }
}
