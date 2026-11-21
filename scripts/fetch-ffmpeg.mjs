// Downloads the official gyan.dev Windows FFmpeg build (ffmpeg + ffprobe, same version)
// into resources/bin/win. Run once after cloning: `npm run fetch:ffmpeg`.
import { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { tmpdir } from 'node:os'

const VERSION = '7.1.1'
const URL = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/ffmpeg-${VERSION}-essentials_build.zip`

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'bin', 'win')

if (existsSync(join(outDir, 'ffmpeg.exe')) && existsSync(join(outDir, 'ffprobe.exe'))) {
  console.log('FFmpeg already present:', outDir)
  process.exit(0)
}

const work = join(tmpdir(), `maker-ffmpeg-${Date.now()}`)
mkdirSync(work, { recursive: true })
const zipPath = join(work, 'ffmpeg.zip')

console.log('Downloading', URL)
const res = await fetch(URL)
if (!res.ok) throw new Error(`Download failed: ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))

console.log('Extracting...')
// Use Windows' bsdtar explicitly; GNU tar from Git Bash misreads "C:" as a remote host.
const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
execFileSync(tar, ['-xf', zipPath, '-C', work])
const extracted = readdirSync(work).find((d) => d.startsWith('ffmpeg-'))
if (!extracted) throw new Error('Unexpected archive layout')

mkdirSync(outDir, { recursive: true })
for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
  renameSync(join(work, extracted, 'bin', exe), join(outDir, exe))
}
renameSync(join(work, extracted, 'LICENSE'), join(outDir, 'FFMPEG_LICENSE.txt'))
rmSync(work, { recursive: true, force: true })
console.log('FFmpeg', VERSION, 'installed to', outDir)
