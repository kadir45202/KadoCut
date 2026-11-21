import { create } from 'zustand'
import { useJobs, type JobState } from '../store/jobs'

/**
 * Remembers which job is processing which clip (per module), so a panel can show progress and a
 * cancel button even after it was closed and reopened.
 */
const useClipJobs = create<{ running: Record<string, string> }>(() => ({ running: {} }))

export const clipJobKey = (moduleId: string, clipId: string) => `${moduleId}:${clipId}`

export function trackClipJob(key: string, jobId: string | null) {
  useClipJobs.setState((s) => {
    const running = { ...s.running }
    if (jobId) running[key] = jobId
    else delete running[key]
    return { running }
  })
}

/** The running job for a clip, if any. */
export function useClipJob(key: string): JobState | undefined {
  const jobId = useClipJobs((s) => s.running[key])
  const job = useJobs((s) => (jobId ? s.jobs[jobId] : undefined))
  return job?.status === 'running' ? job : undefined
}
