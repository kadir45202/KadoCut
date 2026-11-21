// End-to-end check of the real app: launches Electron with an isolated data folder, drives the
// UI with Playwright and verifies the exported MP4 with ffprobe. Screenshots land in
// tests/e2e/output/.
//   npm run test:e2e            core editing + all non-download tools
//   MAKER_E2E_AI=1 npm run test:e2e   also local AI tools (downloads Whisper base, Piper, RVM once)
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { basename, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'tests', 'e2e', 'output')
const fixtures = join(out, 'fixtures')
const data = join(out, 'data')
const componentsCache = join(out, 'components-cache')
const ffmpeg = join(root, 'resources', 'bin', 'win', 'ffmpeg.exe')
const ffprobe = join(root, 'resources', 'bin', 'win', 'ffprobe.exe')
const AI = process.env.MAKER_E2E_AI === '1'

rmSync(data, { recursive: true, force: true })
mkdirSync(fixtures, { recursive: true })
mkdirSync(join(data, 'userData'), { recursive: true })
// Small Whisper model for tests; reuse downloaded components between runs.
writeFileSync(join(data, 'userData', 'settings.json'), JSON.stringify({ captions: { model: 'base', language: 'tr' } }))
if (existsSync(componentsCache)) cpSync(componentsCache, join(data, 'userData', 'components'), { recursive: true })

function fixture(name, args) {
  const path = join(fixtures, name)
  if (!existsSync(path)) execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args, path])
  return path
}

const media = {
  portrait: fixture('portrait.mp4', [
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6:sample_rate=48000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'
  ]),
  landscape: fixture('landscape.mp4', [
    '-f', 'lavfi', '-i', 'smptebars=size=1920x1080:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'anoisesrc=d=4:c=pink:a=0.2:sample_rate=48000',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'
  ]),
  image: fixture('photo.png', ['-f', 'lavfi', '-i', 'mandelbrot=size=1200x1200', '-frames:v', '1']),
  music: fixture('music.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8:sample_rate=48000', '-c:a', 'libmp3lame']),
  // 1 s "speech" / 1 s silence, three times — for the silence remover.
  speech: fixture('speech.mp4', [
    '-f', 'lavfi', '-i', 'color=c=0x334455:size=1080x1920:rate=30:duration=6',
    '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,2),1),0.5*sin(2*PI*330*t),0)':d=6:s=48000",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'
  ])
}

// A warm-looking 2³ LUT.
const lutPath = join(fixtures, 'warm.cube')
writeFileSync(lutPath, ['LUT_3D_SIZE 2', ...Array.from({ length: 8 }, (_, i) => `${i & 1 ? 1 : 0.08} ${i & 2 ? 0.95 : 0.02} ${i & 4 ? 0.8 : 0}`)].join('\n'))

const results = []
const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    await fn()
    results.push(`PASS ${name} (${Date.now() - t0}ms)`)
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message.split('\n')[0]}`)
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {})
    throw err
  }
}

// MAKER_E2E_EXE=dist/win-unpacked/Maker.exe tests the packaged app (same files the installer ships).
const exe = process.env.MAKER_E2E_EXE
const app = await electron.launch({
  ...(exe ? { executablePath: join(root, exe), args: [] } : { args: [root] }),
  cwd: root,
  env: { ...process.env, MAKER_DATA_DIR: data, MAKER_E2E: '1', ELECTRON_RENDERER_URL: '' }
})
if (exe) results.push(`  packaged app: ${exe}`)
const errors = []
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
win.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

const shot = (name) => win.screenshot({ path: join(out, `${name}.png`) })
const quiet = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return { bounds: w.getBounds(), focused: w.isFocused(), focusable: w.isFocusable(), muted: w.webContents.isAudioMuted() }
})
results.push(`  window: x=${quiet.bounds.x} y=${quiet.bounds.y} focusable=${quiet.focusable} muted=${quiet.muted}`)
// Guard: the test window must never be on screen, take focus or make sound.
if (quiet.bounds.x > -10000 || quiet.focused || quiet.focusable || !quiet.muted) throw new Error('Test window is not off-screen/unfocusable/muted')
const stubDialogs = (files, savePath) =>
  app.evaluate(({ dialog }, [f, s]) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: s })
  }, [files, savePath])
const clips = (kind) => win.locator(kind ? `div[data-kind="${kind}"]` : 'div[data-kind]')
const clip = (name) => win.locator('div[data-kind]', { hasText: name }).first()
/** Polls until the locator matches `n` elements (UI updates land on the next frame). */
const expectCount = async (locator, n, what) => {
  for (let i = 0; i < 40; i++) {
    if ((await locator.count()) === n) return
    await win.waitForTimeout(100)
  }
  throw new Error(`${what}: expected ${n}, got ${await locator.count()}`)
}
const seekTo = async (seconds) => {
  await win.keyboard.press('Home')
  for (let i = 0; i < Math.round(seconds * 30); i++) await win.keyboard.press('ArrowRight')
}
const totalTime = () => win.locator('text=/^\\/ \\d\\d:/').innerText()
const leftTab = (name) => win.locator('nav button').filter({ hasText: new RegExp(`^${name}$`) }).first().click()
// The inspector hides its tab bar when a clip has a single tab.
const inspectorTab = async (name) => {
  const tab = win.locator('aside nav button').filter({ hasText: new RegExp(`^${name}$`) }).last()
  if (await tab.count()) await tab.click()
}
/** Confirms the component download prompt if it appears (components may already be cached). */
const acceptDownload = async () => {
  const button = win.getByRole('dialog').getByRole('button', { name: 'İndir' })
  await button.click({ timeout: 15000 }).catch(() => {})
}

try {
  await step('home screen', async () => {
    // The "what's new" sheet greets a fresh install.
    await win.getByRole('button', { name: 'Başlayalım' }).click({ timeout: 15000 }).catch(() => {})
    await win.getByRole('heading', { name: 'Projeler', exact: true }).waitFor({ timeout: 20000 })
    await shot('01-home')
  })

  await step('create project', async () => {
    await win.getByRole('button', { name: /Reels \/ TikTok/ }).first().click()
    await win.getByText('Medya yok').waitFor({ timeout: 10000 })
  })

  await step('import media', async () => {
    await stubDialogs([media.portrait, media.landscape, media.image, media.music], join(out, 'export.mp4'))
    await win.getByRole('button', { name: 'İçe Aktar' }).click()
    await win.getByText('music.mp3').waitFor({ timeout: 15000 })
  })

  await step('add to timeline', async () => {
    for (const name of ['portrait.mp4', 'landscape.mp4', 'photo.png', 'music.mp3']) await win.locator(`[title="${name}"]`).dblclick()
    await expectCount(clips(), 4, 'clips')
    await win.waitForTimeout(1500)
  })

  await step('split (Ctrl+B)', async () => {
    await clip('portrait.mp4').click({ position: { x: 20, y: 30 } })
    await seekTo(2)
    await win.keyboard.press('Control+B')
    await expectCount(clips('video'), 3, 'split')
  })

  await step('undo / redo', async () => {
    await win.keyboard.press('Control+Z')
    await expectCount(clips('video'), 2, 'undo')
    await win.keyboard.press('Control+Shift+Z')
    await expectCount(clips('video'), 3, 'redo')
  })

  await step('speed 2x', async () => {
    await clip('landscape.mp4').click({ position: { x: 20, y: 30 } })
    await inspectorTab('Hız')
    await win.getByRole('button', { name: '2x', exact: true }).click()
    const total = await totalTime()
    if (!total.includes('00:00:11:00')) throw new Error(`unexpected duration ${total}`)
  })

  await step('speed curve', async () => {
    await win.getByRole('radio', { name: 'Eğri' }).click()
    await win.getByRole('button', { name: 'Kahraman' }).click()
    await win.waitForTimeout(300)
  })

  await step('mask + keyframe', async () => {
    await clip('portrait.mp4').click({ position: { x: 20, y: 30 } })
    await inspectorTab('Video')
    await win.getByRole('button', { name: 'Daire' }).click()
    await win.getByRole('button', { name: 'Anahtar kare ekle' }).nth(2).click() // scale
    await shot('03-mask-keyframe')
  })

  await step('freeze frame', async () => {
    await seekTo(1)
    await win.getByRole('button', { name: 'Kareyi dondur' }).click()
    await clip('donmuş kare').waitFor({ timeout: 20000 })
  })

  await step('detach audio', async () => {
    await clip('landscape.mp4').click({ button: 'right', position: { x: 20, y: 30 } })
    await win.getByRole('menuitem', { name: 'Sesi ayır' }).click()
    await expectCount(clips('audio'), 2, 'detached audio')
  })

  await step('text', async () => {
    await win.keyboard.press('t')
    const area = win.locator('textarea')
    await area.fill('Merhaba dünya')
    await win.waitForTimeout(700)
    await clip('Merhaba dünya').waitFor({ timeout: 5000 })
  })

  await step('font picker (bundled + installed)', async () => {
    await clip('Merhaba dünya').click({ position: { x: 10, y: 10 } })
    await win.getByRole('button', { name: 'Yazı tipi' }).click()
    await win.getByPlaceholder('Font ara').fill('bebas')
    await win.getByRole('option', { name: 'Bebas Neue' }).click()
    await win.getByRole('button', { name: 'Yazı tipi' }).click()
    await win.getByPlaceholder('Font ara').fill('')
    await win.waitForTimeout(500)
    const listed = await win.getByRole('option').count()
    await win.keyboard.press('Escape')
    results.push(`  fonts listed: ${listed}`)
    if (listed < 30) throw new Error(`only ${listed} fonts listed`)
  })

  await step('text animation (typewriter + pulse)', async () => {
    await win.getByRole('combobox', { name: 'Giriş' }).click()
    await win.getByRole('option', { name: 'Daktilo' }).click()
    await win.getByRole('combobox', { name: 'Döngü' }).click()
    await win.getByRole('option', { name: 'Nabız' }).click()
  })

  await step('shapes, sticker, progress bar', async () => {
    await leftTab('Grafik')
    await win.getByRole('button', { name: 'Yıldız' }).click()
    await expectCount(clips('shape'), 1, 'shape')
    await win.getByRole('button', { name: '🔥' }).click()
    await win.getByRole('button', { name: 'ABONE OL' }).click()
    await win.getByRole('button', { name: 'Video boyunca ilerleme çubuğu ekle' }).click()
    await expectCount(clips('shape'), 2, 'progress bar')
    await shot('12-graphics')
  })

  await step('blur area (adjustment layer)', async () => {
    await leftTab('Efektler')
    await win.getByRole('button', { name: 'Bulanıklaştırma alanı' }).click()
    await expectCount(clips('adjustment'), 1, 'adjustment')
  })

  await step('group into compound', async () => {
    await clip('Yıldız').click({ position: { x: 5, y: 10 } })
    await clip('ABONE OL').click({ position: { x: 5, y: 10 }, modifiers: ['Shift'] })
    await win.keyboard.press('Control+G')
    await expectCount(clips('compound'), 1, 'compound')
  })

  await step('sound effect', async () => {
    await leftTab('Sesler')
    await win.getByRole('button', { name: 'Oynatma çizgisine ekle' }).first().click()
    await clip('whoosh').waitFor({ timeout: 10000 })
  })

  await step('noise reduction (local)', async () => {
    await clip('music.mp3').click({ position: { x: 20, y: 20 } })
    await inspectorTab('Ses')
    await win.getByRole('switch', { name: 'Gürültüyü azalt' }).click()
    await win.getByText('Yerel (spektral filtre)').waitFor({ timeout: 60000 })
  })

  await step('overlay + chroma key', async () => {
    await clip('photo.png').click({ button: 'right', position: { x: 20, y: 30 } })
    await win.getByRole('menuitem', { name: 'Katmana taşı' }).click()
    await inspectorTab('Video')
    await win.getByRole('button', { name: 'Sağ üst' }).click()
    await win.getByRole('button', { name: 'Yeşil perde (chroma key)' }).click() // expand the section
    await win.getByRole('switch', { name: 'Yeşil perde (chroma key)' }).click()
    await shot('04-overlay')
  })

  await step('transition at a cut', async () => {
    await win.locator('button[aria-label="Geçiş ekle"]').first().click()
    await win.getByRole('button', { name: 'Çapraz geçiş' }).click()
    await win.getByText(/Geçiş \(girişte\): Çapraz geçiş/).waitFor({ timeout: 5000 })
  })

  await step('transition on every cut', async () => {
    await win.getByRole('button', { name: 'Whip pan' }).click()
    await win.getByRole('button', { name: 'Ana parçadaki tüm kesimlere uygula' }).click()
    await win.waitForTimeout(300)
    const n = await win.locator('div[data-main="true"] button[aria-label="Geçiş ekle"]').count()
    if (n < 3) throw new Error(`expected transitions on the main track, got ${n}`)
  })

  await step('color + LUT', async () => {
    await clip('portrait.mp4').click({ position: { x: 20, y: 30 } })
    await inspectorTab('Video')
    const exposure = win.getByRole('slider', { name: 'Pozlama' })
    await exposure.scrollIntoViewIfNeeded()
    const box = await exposure.boundingBox()
    await win.mouse.click(box.x + box.width * 0.65, box.y + box.height / 2)
    await stubDialogs([lutPath], join(out, 'export.mp4'))
    await win.getByRole('button', { name: 'LUT yükle (.cube)' }).click()
    await win.getByText('Yoğunluk').waitFor({ timeout: 5000 })
  })

  await step('crop 1:1 + flip', async () => {
    await win.getByRole('button', { name: '1:1', exact: true }).click()
    await win.getByRole('button', { name: 'Yatay aynala' }).click()
    await shot('09-color-crop')
  })

  await step('blend mode', async () => {
    await clip('photo.png').click({ position: { x: 20, y: 30 } })
    await win.getByRole('combobox', { name: 'Karışım modu' }).click()
    await win.getByRole('option', { name: 'Ekran (Screen)' }).click()
  })

  await step('auto ducking + fade handle', async () => {
    await clip('music.mp3').click({ position: { x: 40, y: 20 } })
    await inspectorTab('Ses')
    await win.getByRole('switch', { name: 'Konuşmada kıs' }).click()
    const handle = win.locator('span[title^="Fade in"]').first()
    const hb = await handle.boundingBox()
    await win.mouse.move(hb.x + 4, hb.y + 4)
    await win.mouse.down()
    await win.mouse.move(hb.x + 60, hb.y + 4, { steps: 6 })
    await win.mouse.up()
    const fade = await win.getByRole('spinbutton').filter({ hasText: 's' }).first().innerText()
    if (!/[1-9]/.test(fade)) throw new Error(`fade-in not set (${fade})`)
  })

  await step('beat detection', async () => {
    await clip('music.mp3').click({ position: { x: 40, y: 20 } })
    await inspectorTab('Ses')
    await win.getByRole('button', { name: 'Vuruşları algıla' }).click()
    await win.getByText(/vuruş bulundu|Vuruş bulunamadı/).waitFor({ timeout: 30000 })
  })

  await step('silence remover', async () => {
    await stubDialogs([media.speech], join(out, 'export.mp4'))
    await leftTab('Medya')
    await win.getByRole('button', { name: 'İçe Aktar' }).click()
    await win.locator('[title="speech.mp4"]').dblclick()
    await win.waitForTimeout(2500) // waveform analysis
    const before = await totalTime()
    await win.getByRole('button', { name: 'Sessizlikleri kaldır' }).click()
    await win.getByText(/sessiz bölüm · /).waitFor({ timeout: 10000 })
    await shot('10-silence-dialog')
    await win.getByRole('dialog').getByRole('button', { name: 'Kaldır' }).click()
    await win.getByText(/sessiz bölüm kaldırıldı/).waitFor({ timeout: 5000 })
    results.push(`  silence: ${before} → ${await totalTime()}`)
  })

  if (AI) {
    await step('text to speech (Piper, local)', async () => {
      await leftTab('Seslendir')
      await win.locator('textarea').fill('Merhaba, bu Maker ile hazırlanmış bir deneme videosudur.')
      await win.getByRole('button', { name: 'Seslendir ve ekle' }).click()
      await acceptDownload()
      await clip('Seslendirme').waitFor({ timeout: 600000 })
    })

    await step('auto captions (Whisper, local)', async () => {
      await clip('Seslendirme').click({ position: { x: 20, y: 20 } })
      await leftTab('Altyazı')
      await win.getByRole('radio', { name: 'Seçili klipler' }).click()
      await win.getByRole('button', { name: 'Altyazı oluştur' }).click()
      await acceptDownload()
      // Wait for the result itself; the success toast may already be gone when components are cached.
      await win.locator('[data-caption="true"]').first().waitFor({ timeout: 600000 })
      await win.waitForTimeout(300)
      const n = await win.locator('[data-caption="true"]').count()
      if (n < 2) throw new Error(`only ${n} caption clips`)
      results.push(`  captions: ${n} clips; ${(await win.locator('[data-caption="true"]').allInnerTexts()).join(' | ').replace(/\s+/g, ' ').slice(0, 160)}`)
    })

    await step('text-based editing (Whisper, local)', async () => {
      // A "talking" video: the Piper voice-over from the TTS step on a plain background.
      const projectsDir = join(data, 'Projects')
      const tts = readdirSync(projectsDir)
        .flatMap((id) => (existsSync(join(projectsDir, id, 'media')) ? readdirSync(join(projectsDir, id, 'media')).map((f) => join(projectsDir, id, 'media', f)) : []))
        .find((f) => /^tts-/.test(basename(f)))
      if (!tts) throw new Error('no voice-over file to build the talking video from')
      const talking = join(fixtures, 'talking.mp4')
      execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x223344:size=1080x1920:rate=30', '-i', tts, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', talking])
      await stubDialogs([talking], join(out, 'export.mp4'))
      await leftTab('Medya')
      await win.getByRole('button', { name: 'İçe Aktar' }).click()
      await win.locator('[title="talking.mp4"]').dblclick()
      await leftTab('Transkript')
      await win.getByRole('button', { name: 'Konuşmayı yazıya dök' }).click()
      await acceptDownload()
      const words = win.locator('[data-transcript] span')
      await win.getByRole('button', { name: 'Yeniden yazıya dök' }).waitFor({ timeout: 600000 }) // every clip done
      await words.first().waitFor({ timeout: 5000 })
      const before = await totalTime()
      const count = await words.count()
      // Cut two words of the talking video (the last clip on the main track).
      await words.nth(count - 3).click()
      await words.nth(count - 2).click({ modifiers: ['Shift'] })
      await win.keyboard.press('Delete')
      await win.getByText(/bölüm kesildi/).waitFor({ timeout: 5000 })
      results.push(`  transcript: ${count} words; ${before} → ${await totalTime()}`)
    })

    await step('auto reframe (face detector, local)', async () => {
      await clip('landscape.mp4').click({ position: { x: 20, y: 30 } })
      await inspectorTab('Video')
      await win.getByRole('button', { name: 'Otomatik çerçeveleme' }).click() // expand the section
      // Start watching for the result first: with the model cached the job takes ~1 s.
      const result = win.getByText(/yüze göre çerçevelendi|yüz bulunamadı/).waitFor({ timeout: 120000 })
      await win.getByRole('button', { name: 'Yüzü takip ederek çerçevele' }).click()
      await Promise.race([acceptDownload(), result])
      await result
    })

    await step('remove background (RVM, local)', async () => {
      await clip('landscape.mp4').click({ position: { x: 20, y: 30 } })
      await inspectorTab('Video')
      await win.getByRole('switch', { name: 'Arka planı sil' }).click()
      await acceptDownload()
      await win.getByText('Yerel (RVM modeli)').waitFor({ timeout: 600000 })
    })
  }

  await step('preview during a transition', async () => {
    await seekTo(4)
    await win.waitForTimeout(1200)
    await win.locator('canvas[data-canvas]').screenshot({ path: join(out, '11-preview-transition.png') })
  })

  await step('timeline screenshot', async () => {
    await win.keyboard.press('Shift+Z')
    await seekTo(2.5)
    await win.waitForTimeout(800)
    await shot('05-editor-full')
  })

  await step('export', async () => {
    const expected = await totalTime()
    await win.keyboard.press('Control+E')
    await win.getByRole('button', { name: 'Kare gönderi' }).click() // batch: also a 1:1 file
    await win.getByRole('dialog').getByRole('button', { name: 'Dışa Aktar' }).click()
    await win.getByText('Dışa aktarma tamamlandı').waitFor({ timeout: 600000 })
    await shot('06-export-done')
    const info = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', join(out, 'export.mp4')]).toString())
    const v = info.streams.find((s) => s.codec_type === 'video')
    const a = info.streams.find((s) => s.codec_type === 'audio')
    const duration = Number(info.format.duration)
    const [, hh, mm, ss, ff] = /(\d\d):(\d\d):(\d\d):(\d\d)/.exec(expected)
    const want = Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ff) / 30
    if (!v || v.width !== 1080 || v.height !== 1920) throw new Error('bad video stream')
    if (!a) throw new Error('no audio stream')
    if (Math.abs(duration - want) > 0.3) throw new Error(`duration ${duration}, expected ~${want}`)
    results.push(`  export: ${v.codec_name} ${v.width}x${v.height} ${v.avg_frame_rate} + ${a.codec_name}, ${duration.toFixed(2)}s`)
    // Frame grab from the middle for a visual check.
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(want / 2), '-i', join(out, 'export.mp4'), '-frames:v', '1', '-vf', 'scale=360:-2', join(out, '07-export-frame.png')])
    const square = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', join(out, 'export-1080x1080.mp4')]).toString()).streams.find((x) => x.codec_type === 'video')
    if (!square || square.width !== 1080 || square.height !== 1080) throw new Error('batch 1:1 export missing')
    results.push(`  batch export: +${square.width}x${square.height}`)
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '2.2', '-i', join(out, 'export-1080x1080.mp4'), '-frames:v', '1', '-vf', 'scale=360:-2', join(out, '14-export-square.png')])
  })

  await step('shortcut settings', async () => {
    await win.getByRole('dialog').getByRole('button', { name: 'Kapat' }).click()
    await win.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await win.getByRole('button', { name: 'Kısayollar' }).click()
    await win.getByRole('combobox', { name: 'Hazır set' }).click()
    await win.getByRole('option', { name: 'Premiere Pro' }).click()
    await win.getByText('Ctrl+M').waitFor({ timeout: 3000 })
    await win.keyboard.press('Escape')
  })

  await step('home shows the project', async () => {
    await win.getByRole('button', { name: 'Projeler' }).click()
    await win.getByText('Son Projeler').waitFor()
    await shot('08-home-with-project')
  })

  await step('project from a built-in template', async () => {
    await win.getByRole('button', { name: /Alıntı kartı/ }).click()
    await expectCount(clips('text'), 2, 'template text clips')
    await seekTo(2)
    await win.waitForTimeout(800)
    await shot('15-template')
  })
} finally {
  console.log(results.join('\n'))
  if (errors.length) console.log('Renderer errors:\n' + [...new Set(errors)].join('\n'))
  if (AI && existsSync(join(data, 'userData', 'components'))) cpSync(join(data, 'userData', 'components'), componentsCache, { recursive: true })
  await app.close().catch(() => {})
}
