import type {} from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ComponentId } from '@shared/components'
import type { JobError, WorkerEnv } from '@shared/jobs'

export interface JobContext {
  env: WorkerEnv
  signal: AbortSignal
  progress(progress: number, message?: string): void
  log(message: string): void
}

export class WorkerJobError extends Error {
  constructor(readonly error: JobError) {
    super(error.message)
  }
}

export const fail = (code: JobError['code'], message: string, componentIds?: ComponentId[]) =>
  new WorkerJobError({ code, message, componentIds })

/**
 * Folders of installed components. If any are missing, all missing ones are reported together
 * so the user is asked to download once.
 */
export function requireComponents<const T extends ComponentId[]>(ctx: JobContext, ...ids: T): { [K in keyof T]: string } {
  const dirs = ids.map((id) => join(ctx.env.componentsDir, id))
  const missing = ids.filter((_, i) => !existsSync(join(dirs[i], '.installed')))
  if (missing.length) throw fail('missing-component', `Not installed: ${missing.join(', ')}`, missing)
  return dirs as { [K in keyof T]: string }
}

/** Finds a file anywhere below `dir` (zip layouts differ between releases). */
export function findFile(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return full
    if (entry.isDirectory()) {
      const hit = findFile(full, name)
      if (hit) return hit
    }
  }
  return null
}

export interface RunOptions {
  /** Media duration in seconds; enables progress from ffmpeg's -progress output. */
  duration?: number
  stdin?: string
  onStderr?(chunk: string): void
}

/** Runs a process, honouring cancellation; rejects with the stderr tail on failure. */
export function runProcess(ctx: JobContext, exe: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    if (ctx.signal.aborted) return reject(fail('cancelled', 'Cancelled'))
    const proc = spawn(exe, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    const onAbort = () => proc.kill()
    ctx.signal.addEventListener('abort', onAbort)
    proc.stdout.on('data', (d: Buffer) => {
      const text = d.toString()
      stdout += text
      if (opts.duration) {
        const m = /out_time_us=(\d+)/.exec(text)
        if (m) ctx.progress(Math.min(0.99, Number(m[1]) / 1e6 / opts.duration))
      }
      if (stdout.length > 1_000_000) stdout = stdout.slice(-500_000)
    })
    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString()
      stderr = (stderr + text).slice(-4000)
      opts.onStderr?.(text)
    })
    proc.on('error', (err) => reject(fail('failed', err.message)))
    proc.on('close', (code) => {
      ctx.signal.removeEventListener('abort', onAbort)
      if (ctx.signal.aborted) return reject(fail('cancelled', 'Cancelled'))
      if (code === 0) resolve(stdout)
      else reject(fail('failed', `${exe.split(/[\\/]/).pop()} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`))
    })
    if (opts.stdin !== undefined) {
      proc.stdin.write(opts.stdin)
      proc.stdin.end()
    }
  })
}

export function ffmpeg(ctx: JobContext, args: string[], opts: RunOptions = {}) {
  const base = ['-hide_banner', '-loglevel', 'error', '-y']
  if (opts.duration) base.push('-progress', 'pipe:1', '-nostats')
  return runProcess(ctx, ctx.env.ffmpeg, [...base, ...args], opts)
}

export async function probeDuration(ctx: JobContext, path: string): Promise<number> {
  const out = await runProcess(ctx, ctx.env.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path])
  return Number(out.trim()) || 0
}

/** Unique file name inside the project media folder. */
export function projectFile(ctx: JobContext, prefix: string, ext: string): string {
  if (!ctx.env.projectMediaDir) throw fail('failed', 'No project folder for this job')
  return join(ctx.env.projectMediaDir, `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`)
}
