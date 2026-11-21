import type {} from 'electron'
import type { JobError, WorkerRequest, WorkerResponse } from '@shared/jobs'
import { WorkerJobError, type JobContext } from './context'
import { handlers } from './handlers'

/**
 * Utility-process entry. One process runs exactly one job and exits; main kills the whole
 * process tree on cancel/timeout, so a misbehaving tool can never affect the editor.
 */
const port = process.parentPort
const controller = new AbortController()
const send = (msg: WorkerResponse) => port.postMessage(msg)

function toJobError(err: unknown): JobError {
  if (err instanceof WorkerJobError) return err.error
  if (controller.signal.aborted) return { code: 'cancelled', message: 'Cancelled' }
  return { code: 'failed', message: err instanceof Error ? err.message : String(err) }
}

port.on('message', async (event) => {
  const msg = event.data as WorkerRequest
  if (msg.type === 'cancel') {
    controller.abort()
    return
  }
  const ctx: JobContext = {
    env: msg.env,
    signal: controller.signal,
    progress: (progress, message) => send({ type: 'progress', progress, message }),
    log: (message) => send({ type: 'log', level: 'info', message })
  }
  try {
    const handler = (handlers as Record<string, ((input: never, ctx: JobContext) => Promise<unknown>) | undefined>)[msg.kind]
    if (!handler) throw new Error(`No worker handler for ${msg.kind}`)
    const output = await handler(msg.input as never, ctx)
    send({ type: 'done', output })
  } catch (err) {
    send({ type: 'error', error: toJobError(err) })
  } finally {
    setTimeout(() => process.exit(0), 200)
  }
})
