import { rename, writeFile, unlink } from 'node:fs/promises'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Write via temp file + rename so a crash mid-write never leaves a truncated file.
 * Retries the rename because antivirus/indexers on Windows briefly lock fresh files.
 */
export async function writeFileAtomic(path: string, data: string | Buffer): Promise<void> {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data)
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, path)
      return
    } catch (err) {
      if (attempt >= 5) {
        await unlink(tmp).catch(() => {})
        throw err
      }
      await sleep(50 * (attempt + 1))
    }
  }
}
