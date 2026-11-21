import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { COMPONENTS, type ComponentSpec } from '@shared/components'
import type { JobInput, JobOutput } from '@shared/jobs'
import { fail, runProcess, type JobContext } from '../context'

const systemTar = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

export async function installComponent(input: JobInput<'components.install'>, ctx: JobContext): Promise<JobOutput<'components.install'>> {
  const spec: ComponentSpec | undefined = COMPONENTS[input.id]
  if (!spec) throw fail('failed', `Unknown component ${input.id}`)
  const dir = join(ctx.env.componentsDir, spec.id)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const total = spec.size
  let done = 0
  for (const file of spec.files) {
    const target = join(dir, file.name)
    const partial = `${target}.partial`
    const res = await fetch(file.url, { signal: ctx.signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw fail('failed', `Download failed (${res.status}) for ${file.name}`)
    const expected = Number(res.headers.get('content-length') ?? 0)
    let received = 0
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length
        ctx.progress(Math.min(0.97, (done + received) / total), file.name)
        cb(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body as never), counter, createWriteStream(partial), { signal: ctx.signal })
    if (expected && received !== expected) throw fail('failed', `Incomplete download for ${file.name}`)
    await rename(partial, target)
    done += received

    if (file.extract) {
      ctx.progress(0.98, 'extract')
      await runProcess(ctx, process.platform === 'win32' ? systemTar() : 'tar', ['-xf', target, '-C', dir])
      await unlink(target)
    }
  }
  if (!existsSync(dir)) throw fail('failed', 'Install folder vanished')
  await writeFile(join(dir, '.installed'), new Date().toISOString())
  return { id: input.id }
}
