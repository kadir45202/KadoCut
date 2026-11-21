import { BrowserWindow, utilityProcess, type UtilityProcess } from 'electron'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { JOB_EVENT_CHANNEL } from '@shared/api'
import type { JobError, JobEvent, JobKind, WorkerEnv, WorkerRequest, WorkerResponse } from '@shared/jobs'
import { scoped } from './logger'
import { paths } from './paths'
import { projectMediaDir } from './projects'
import { getSecret, getSettings } from './settings'

const log = scoped('jobs')

/** How many jobs of a kind may run at once; heavy AI work is serialized. */
const CONCURRENCY: Partial<Record<JobKind, number>> = {
  'media.audio': 3,
  'media.filmstrip': 2,
  'media.proxy': 1,
  'components.install': 2
}

/** Hard timeouts: a hung job is killed instead of blocking the queue forever. */
const TIMEOUT_MS: Partial<Record<JobKind, number>> = {
  'media.audio': 10 * 60_000,
  'media.filmstrip': 10 * 60_000,
  'media.freezeFrame': 60_000,
  'components.install': 2 * 60 * 60_000,
  'export.render': 6 * 60 * 60_000
}
const DEFAULT_TIMEOUT_MS = 60 * 60_000

export interface RunnerContext {
  jobId: string
  progress(progress: number, message?: string): void
  signal: AbortSignal
}

/** Jobs that do not run in a utility process (e.g. export uses a hidden render window). */
export type CustomRunner = (input: unknown, ctx: RunnerContext) => Promise<unknown>

interface Job {
  id: string
  kind: JobKind
  input: Record<string, unknown>
  label: string
  abort: AbortController
}

class JobError_ extends Error {
  constructor(readonly error: JobError) {
    super(error.message)
  }
}

export function jobError(code: JobError['code'], message: string): Error {
  return new JobError_({ code, message })
}

/** Kills a process and every child it spawned (ffmpeg, whisper...). */
function killTree(pid: number | undefined) {
  if (!pid) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

/** Stable cache folder per source file version (path + size + mtime). */
function cacheDirFor(path: string): string {
  let key = path
  try {
    const s = statSync(path)
    key += `|${s.size}|${s.mtimeMs}`
  } catch {
    // Missing file: worker will report the error.
  }
  return join(paths.cacheDir(), createHash('sha1').update(key).digest('hex').slice(0, 20))
}

export class JobManager {
  private queue: Job[] = []
  private running = new Map<string, Job>()
  private runners = new Map<JobKind, CustomRunner>()

  constructor(private workerPath: string) {}

  registerRunner(kind: JobKind, runner: CustomRunner) {
    this.runners.set(kind, runner)
  }

  start(kind: JobKind, input: unknown, label: string): string {
    const job: Job = { id: randomUUID(), kind, input: (input ?? {}) as Record<string, unknown>, label, abort: new AbortController() }
    this.queue.push(job)
    this.emit({ type: 'started', jobId: job.id, kind, label })
    this.pump()
    return job.id
  }

  cancel(jobId: string) {
    const queued = this.queue.findIndex((j) => j.id === jobId)
    if (queued >= 0) {
      this.queue.splice(queued, 1)
      this.emit({ type: 'error', jobId, error: { code: 'cancelled', message: 'Cancelled' } })
      return
    }
    this.running.get(jobId)?.abort.abort()
  }

  private emit(event: JobEvent) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(JOB_EVENT_CHANNEL, event)
    }
  }

  private runningOf(kind: JobKind) {
    let n = 0
    for (const j of this.running.values()) if (j.kind === kind) n++
    return n
  }

  private pump() {
    for (const job of [...this.queue]) {
      if (this.runningOf(job.kind) >= (CONCURRENCY[job.kind] ?? 1)) continue
      this.queue.splice(this.queue.indexOf(job), 1)
      this.running.set(job.id, job)
      void this.execute(job)
    }
  }

  private async execute(job: Job) {
    const started = Date.now()
    const ctx: RunnerContext = {
      jobId: job.id,
      signal: job.abort.signal,
      progress: (progress, message) => this.emit({ type: 'progress', jobId: job.id, progress, message })
    }
    try {
      const custom = this.runners.get(job.kind)
      const output = custom ? await custom(job.input, ctx) : await this.runInWorker(job, ctx)
      log.info(`${job.kind} ${job.id} done in ${Date.now() - started}ms`)
      this.emit({ type: 'done', jobId: job.id, output })
    } catch (err) {
      const error: JobError =
        err instanceof JobError_
          ? err.error
          : { code: job.abort.signal.aborted ? 'cancelled' : 'failed', message: err instanceof Error ? err.message : String(err) }
      if (error.code !== 'cancelled') log.error(`${job.kind} ${job.id} failed (${error.code}): ${error.message}`)
      this.emit({ type: 'error', jobId: job.id, error })
    } finally {
      this.running.delete(job.id)
      this.pump()
    }
  }

  private async buildEnv(job: Job): Promise<WorkerEnv> {
    const settings = getSettings()
    const sourcePath = typeof job.input.path === 'string' ? job.input.path : ''
    const projectId = typeof job.input.projectId === 'string' ? job.input.projectId : ''
    const env: WorkerEnv = {
      ffmpeg: paths.ffmpeg(),
      ffprobe: paths.ffprobe(),
      cacheDir: sourcePath ? cacheDirFor(sourcePath) : paths.cacheDir(),
      componentsDir: paths.componentsDir(),
      projectMediaDir: projectId ? projectMediaDir(projectId) : '',
      secrets: {},
      elevenVoiceId: settings.tts.elevenVoiceId
    }
    // Secrets only go to the jobs that need them.
    if (job.kind === 'audio.denoise' || job.kind === 'tts.synthesize') {
      const key = getSecret('elevenlabs')
      if (key) env.secrets.elevenlabs = key
    }
    if (job.kind === 'ai.translate' || job.kind === 'ai.highlights') {
      const key = getSecret('anthropic')
      if (key) env.secrets.anthropic = key
    }
    if (job.kind === 'video.removeBackground') {
      const key = getSecret('replicate')
      if (key) env.secrets.replicate = key
    }
    await mkdir(env.cacheDir, { recursive: true })
    if (env.projectMediaDir) await mkdir(env.projectMediaDir, { recursive: true })
    return env
  }

  private async runInWorker(job: Job, ctx: RunnerContext): Promise<unknown> {
    const env = await this.buildEnv(job)
    return new Promise((resolve, reject) => {
      let settled = false
      let child: UtilityProcess
      try {
        child = utilityProcess.fork(this.workerPath, [], { serviceName: `Maker ${job.kind}`, stdio: 'pipe' })
      } catch (err) {
        reject(jobError('crashed', `Could not start worker: ${String(err)}`))
        return
      }
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        job.abort.signal.removeEventListener('abort', onAbort)
        fn()
        // Give the worker a moment to exit cleanly, then make sure nothing is left behind.
        setTimeout(() => killTree(child.pid), 1500)
      }
      const timer = setTimeout(() => {
        killTree(child.pid)
        finish(() => reject(jobError('timeout', 'The operation took too long and was stopped')))
      }, TIMEOUT_MS[job.kind] ?? DEFAULT_TIMEOUT_MS)
      const onAbort = () => {
        child.postMessage({ type: 'cancel' } satisfies WorkerRequest)
        setTimeout(() => killTree(child.pid), 2000)
        finish(() => reject(jobError('cancelled', 'Cancelled')))
      }
      job.abort.signal.addEventListener('abort', onAbort)

      child.stdout?.on('data', (d: Buffer) => log.info(`[${job.kind}] ${d.toString().trimEnd()}`))
      child.stderr?.on('data', (d: Buffer) => log.warn(`[${job.kind}] ${d.toString().trimEnd()}`))
      child.on('message', (msg: WorkerResponse) => {
        if (msg.type === 'progress') ctx.progress(msg.progress, msg.message)
        else if (msg.type === 'log') log[msg.level === 'info' ? 'info' : msg.level === 'warn' ? 'warn' : 'error'](`[${job.kind}] ${msg.message}`)
        else if (msg.type === 'done') finish(() => resolve(msg.output))
        else if (msg.type === 'error') finish(() => reject(new JobError_(msg.error)))
      })
      child.on('exit', (code) => {
        finish(() => reject(jobError('crashed', `The worker stopped unexpectedly (code ${code})`)))
      })
      child.postMessage({ type: 'run', jobId: job.id, kind: job.kind, input: job.input, env } satisfies WorkerRequest)
    })
  }
}
