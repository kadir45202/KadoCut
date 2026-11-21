import { create } from 'zustand'
import type { ComponentId } from '@shared/components'
import type { JobError, JobEvent, JobInput, JobKind, JobOutput } from '@shared/jobs'
import { api } from '@renderer/lib/api'

export interface JobState {
  id: string
  kind: JobKind
  label: string
  progress: number
  message?: string
  status: 'running' | 'done' | 'error'
  error?: JobError
  startedAt: number
  /** Background housekeeping (waveforms, thumbnails) is hidden from the jobs list. */
  silent: boolean
}

export class JobFailure extends Error {
  constructor(readonly error: JobError) {
    super(error.message)
  }
}

const SILENT_KINDS: JobKind[] = ['media.audio', 'media.filmstrip', 'media.proxy', 'audio.stretch']

export const useJobs = create<{ jobs: Record<string, JobState> }>(() => ({ jobs: {} }))

type Waiter = { resolve(output: unknown): void; reject(err: JobFailure): void }
const waiters = new Map<string, Waiter>()

function settle(id: string) {
  const job = useJobs.getState().jobs[id]
  const waiter = waiters.get(id)
  if (!job || !waiter || job.status === 'running') return
  waiters.delete(id)
  if (job.status === 'done') waiter.resolve(outputs.get(id))
  else waiter.reject(new JobFailure(job.error ?? { code: 'failed', message: 'Unknown error' }))
  outputs.delete(id)
}

const outputs = new Map<string, unknown>()

function update(id: string, patch: Partial<JobState>) {
  useJobs.setState((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...patch } } } : s))
}

function onEvent(e: JobEvent) {
  switch (e.type) {
    case 'started':
      useJobs.setState((s) => ({
        jobs: {
          ...s.jobs,
          [e.jobId]: { id: e.jobId, kind: e.kind, label: e.label, progress: 0, status: 'running', startedAt: Date.now(), silent: SILENT_KINDS.includes(e.kind) }
        }
      }))
      break
    case 'progress':
      update(e.jobId, { progress: e.progress, message: e.message })
      break
    case 'done':
      outputs.set(e.jobId, e.output)
      update(e.jobId, { status: 'done', progress: 1 })
      break
    case 'error':
      update(e.jobId, { status: 'error', error: e.error })
      break
  }
  settle(e.jobId)
  if (e.type === 'done' || e.type === 'error') setTimeout(() => prune(e.jobId), 8000)
}

function prune(id: string) {
  useJobs.setState((s) => {
    const { [id]: _removed, ...rest } = s.jobs
    return { jobs: rest }
  })
}

let initialized = false
export function initJobs() {
  if (initialized) return
  initialized = true
  api.jobs.onEvent(onEvent)
}

/** Starts a job and resolves with its output (rejects with JobFailure). */
export async function runJob<K extends JobKind>(kind: K, input: JobInput<K>, label: string, onStart?: (jobId: string) => void): Promise<JobOutput<K>> {
  const id = await api.jobs.start(kind, input, label)
  onStart?.(id)
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve: resolve as (o: unknown) => void, reject })
    settle(id)
  })
}

export const cancelJob = (id: string) => api.jobs.cancel(id)

/** Asks the user to download missing components; resolves true when installed. */
type ComponentPrompt = (ids: ComponentId[]) => Promise<boolean>
let componentPrompt: ComponentPrompt = async () => false
export function setComponentPrompt(fn: ComponentPrompt) {
  componentPrompt = fn
}

/**
 * Like runJob, but when a local AI component is missing it offers the download and retries.
 */
export async function runJobWithComponents<K extends JobKind>(kind: K, input: JobInput<K>, label: string, onStart?: (jobId: string) => void): Promise<JobOutput<K>> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await runJob(kind, input, label, onStart)
    } catch (err) {
      if (!(err instanceof JobFailure) || err.error.code !== 'missing-component' || !err.error.componentIds?.length) throw err
      if (!(await componentPrompt(err.error.componentIds))) throw new JobFailure({ code: 'cancelled', message: 'Cancelled' })
    }
  }
  throw new JobFailure({ code: 'failed', message: 'Components could not be installed' })
}
