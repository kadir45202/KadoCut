// End-to-end check of the 0.3 "pro" tools (effects library, viewer guides, markers, voiceover,
// export extras, media management...). Same quiet launch as run.mjs: the window stays off-screen,
// unfocusable and muted. Screenshots land in tests/e2e/output/pro-*.png.
//   npm run test:e2e:pro
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'tests', 'e2e', 'output')
const fixtures = join(out, 'fixtures')
const data = join(out, 'data-pro')
const ffmpeg = join(root, 'resources', 'bin', 'win', 'ffmpeg.exe')
const ffprobe = join(root, 'resources', 'bin', 'win', 'ffprobe.exe')

rmSync(data, { recursive: true, force: true })
mkdirSync(fixtures, { recursive: true })
mkdirSync(join(data, 'userData'), { recursive: true })
writeFileSync(join(data, 'userData', 'settings.json'), JSON.stringify({}))

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
  music: fixture('music.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8:sample_rate=48000', '-c:a', 'libmp3lame']),
  // Photos for the slideshow: landscape, portrait and square.
  photos: [
    fixture('photo-a.png', ['-f', 'lavfi', '-i', 'testsrc2=size=1600x900', '-frames:v', '1']),
    fixture('photo-b.png', ['-f', 'lavfi', '-i', 'mandelbrot=size=900x1600', '-frames:v', '1']),
    fixture('photo-c.png', ['-f', 'lavfi', '-i', 'cellauto=size=1000x1000:rule=110', '-frames:v', '1'])
  ]
}

const results = []
const step = async (name, fn) => {
  const t0 = Date.now()
  try {
    await fn()
    results.push(`PASS ${name} (${Date.now() - t0}ms)`)
  } catch (err) {
    results.push(`FAIL ${name}: ${err.message.split('\n')[0]}`)
    await shot(`pro-fail-${name.replace(/\W+/g, '-')}`).catch(() => {})
    throw err
  }
}

const exe = process.env.MAKER_E2E_EXE
const fakeMic = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
const app = await electron.launch({
  // A fake microphone (a beep) for the voiceover test; nothing is played out loud.
  ...(exe ? { executablePath: join(root, exe), args: [...fakeMic] } : { args: [root, ...fakeMic] }),
  cwd: root,
  env: { ...process.env, MAKER_DATA_DIR: data, MAKER_E2E: '1', ELECTRON_RENDERER_URL: '' }
})
const errors = []
const win = await app.firstWindow()
win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
win.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

const shot = (name) => win.screenshot({ path: join(out, `${name}.png`) })
const quiet = await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  return { bounds: w.getBounds(), focused: w.isFocused(), focusable: w.isFocusable(), muted: w.webContents.isAudioMuted() }
})
if (quiet.bounds.x > -10000 || quiet.focused || quiet.focusable || !quiet.muted) throw new Error('Test window is not off-screen/unfocusable/muted')
const stubDialogs = (files, savePath) =>
  app.evaluate(({ dialog }, [f, s]) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: s })
  }, [files, savePath])
const clips = (kind) => win.locator(kind ? `div[data-kind="${kind}"]` : 'div[data-kind]')
const clip = (name) => win.locator('div[data-kind]', { hasText: name }).first()
const expectCount = async (locator, n, what) => {
  for (let i = 0; i < 40; i++) {
    if ((await locator.count()) === n) return
    await win.waitForTimeout(100)
  }
  throw new Error(`${what}: expected ${n}, got ${await locator.count()}`)
}
const leftTab = (name) => win.locator('nav button').filter({ hasText: new RegExp(`^${name}$`) }).first().click()
const probe = (file) => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).toString())

try {
  await step('create project + import', async () => {
    // First start shows what's new in 0.3, once (it hides the page from the accessibility tree).
    await win.getByRole('dialog', { name: 'Maker 0.5’te neler var?' }).waitFor({ timeout: 20000 })
    await win.waitForTimeout(600)
    await shot('pro-whats-new')
    await win.getByRole('button', { name: 'Başlayalım' }).click()
    await win.getByRole('dialog').waitFor({ state: 'detached', timeout: 3000 })
    await win.getByRole('button', { name: /Reels \/ TikTok/ }).first().click()
    await win.getByText('Medya yok').waitFor({ timeout: 10000 })
    await stubDialogs([media.portrait, media.landscape, media.music], join(out, 'pro-export.mp4'))
    await win.getByRole('button', { name: 'İçe Aktar' }).click()
    await win.getByText('music.mp3').waitFor({ timeout: 15000 })
    for (const name of ['portrait.mp4', 'landscape.mp4', 'music.mp3']) await win.locator(`[title="${name}"]`).dblclick()
    await expectCount(clips(), 3, 'clips')
  })

  await step('effects library', async () => {
    await leftTab('Efektler')
    // Thumbnails are rendered by the real compositor.
    await win.locator('button[data-effect="vhs"] img').waitFor({ timeout: 10000 })
    await shot('pro-effects-panel')
    // Contact sheet of every effect thumbnail, for eyeballing the shaders.
    const sheet = await win.evaluate(() => {
      const tiles = [...document.querySelectorAll('button[data-effect]')]
      const c = document.createElement('canvas')
      const cols = 6
      c.width = cols * 260
      c.height = Math.ceil(tiles.length / cols) * 190
      const g = c.getContext('2d')
      g.fillStyle = '#111'
      g.fillRect(0, 0, c.width, c.height)
      g.font = '16px sans-serif'
      g.fillStyle = '#fff'
      tiles.forEach((b, i) => {
        const x = (i % cols) * 260 + 2
        const y = Math.floor(i / cols) * 190 + 2
        g.drawImage(b.querySelector('img'), x, y, 256, 160)
        g.fillText(b.dataset.effect, x + 4, y + 180)
      })
      return c.toDataURL('image/png').split(',')[1]
    })
    writeFileSync(join(out, 'pro-effects-sheet.png'), Buffer.from(sheet, 'base64'))
    await clip('portrait.mp4').click({ position: { x: 20, y: 30 } })
    await win.locator('button[data-effect="vhs"]').click()
    await expectCount(clips('adjustment'), 1, 'effect layer')
    await win.getByRole('combobox', { name: 'Tür' }).click()
    await win.getByRole('option', { name: '4’lü ekran' }).click()
    await clip('4’lü ekran').waitFor({ timeout: 3000 })
    await win.waitForTimeout(400)
    await shot('pro-effect-split4')
  })
  await step('viewer guides, scopes, smart snapping', async () => {
    await win.getByRole('button', { name: 'Kılavuzlar ve ölçekler' }).click()
    await win.getByRole('radio', { name: 'Reels' }).click()
    await win.getByRole('switch', { name: 'Üçte bir ızgarası' }).click()
    await win.getByRole('switch', { name: 'Renk ölçekleri' }).click()
    await win.keyboard.press('Escape')
    await win.getByTestId('scopes').waitFor({ timeout: 3000 })
    await win.getByText('Butonlar').waitFor({ timeout: 3000 })
    await win.waitForTimeout(500)
    await shot('pro-guides-waveform')
    await win.getByTestId('scopes').getByRole('radio', { name: 'Vektör' }).click()
    await win.waitForTimeout(400)
    await win.getByTestId('scopes').screenshot({ path: join(out, 'pro-vectorscope.png') })
    await win.getByTestId('scopes').getByRole('radio', { name: 'Histogram' }).click()
    await win.waitForTimeout(400)
    await win.getByTestId('scopes').screenshot({ path: join(out, 'pro-histogram.png') })
    // Drag the selected video a few pixels: its centre snaps back onto the canvas centre.
    await clip('portrait.mp4').click({ position: { x: 20, y: 30 } })
    const box = await win.locator('canvas[data-canvas]').boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    await win.mouse.move(cx, cy)
    await win.mouse.down()
    await win.mouse.move(cx + 3, cy + 40, { steps: 4 })
    await shot('pro-smart-guide')
    await win.mouse.up()
  })
  await step('markers, in/out range, chapters', async () => {
    await win.keyboard.press('Escape')
    await win.keyboard.press('Home')
    await win.keyboard.press('m')
    await win.keyboard.press('Shift+ArrowRight')
    await win.keyboard.press('Shift+ArrowRight')
    await win.keyboard.press('m')
    await win.keyboard.press('i')
    for (let i = 0; i < 5; i++) await win.keyboard.press('Shift+ArrowRight')
    await win.keyboard.press('m')
    await win.keyboard.press('o')
    await expectCount(win.getByTestId('marker'), 3, 'markers')
    await win.getByTestId('range').waitFor({ timeout: 3000 })
    await leftTab('İşaretler')
    const chapters = await win.getByTestId('chapters').innerText()
    if (!chapters.startsWith('00:00 İşaret 1\n00:02 İşaret 2\n00:07 İşaret 3')) throw new Error(`chapters: ${chapters}`)
    await win.getByRole('textbox', { name: 'İşaret adı' }).nth(1).fill('Ana kısım')
    await win.keyboard.press('Enter')
    await win.getByTestId('chapters').getByText('00:02 Ana kısım').waitFor({ timeout: 3000 })
    // Capture instead of touching the real clipboard of the person using this machine.
    await app.evaluate(({ clipboard }) => {
      globalThis.__copied = ''
      clipboard.writeText = (text) => void (globalThis.__copied = text)
    })
    await win.getByRole('button', { name: 'Bölümleri kopyala' }).click()
    await win.getByText('Bölüm listesi panoya kopyalandı').waitFor({ timeout: 3000 })
    const copied = await app.evaluate(() => globalThis.__copied)
    if (!copied.includes('Ana kısım')) throw new Error(`clipboard: ${copied}`)
    // Shift+M / Ctrl+Shift+M jump between markers.
    await win.keyboard.press('Home')
    await win.keyboard.press('Shift+M')
    await win.keyboard.press('Shift+M')
    const tc = await win.locator('text=/^00:00:0\\d:\\d\\d$/').first().innerText()
    if (tc !== '00:00:07:00') throw new Error(`jumped to ${tc}`)
    await shot('pro-markers')
  })
  await step('voice changer + level meter', async () => {
    await clip('music.mp3').click({ position: { x: 20, y: 20 } })
    await win.locator('aside nav button').filter({ hasText: /^Ses$/ }).last().click().catch(() => {})
    await win.getByRole('button', { name: 'Ses değiştirici' }).click()
    await win.getByRole('radio', { name: 'Robot' }).click()
    if ((await win.getByRole('radio', { name: 'Robot' }).getAttribute('aria-checked')) !== 'true') throw new Error('voice not set')
    await win.keyboard.press('Home')
    await win.keyboard.press('Space')
    // The meter draws coloured bars while the mix plays (the window itself is muted). On a busy
    // machine the music may still be decoding for a moment, so give it a few seconds.
    let lit = 0
    for (let i = 0; i < 10 && lit < 20; i++) {
      await win.waitForTimeout(700)
      lit = await win.getByTestId('meter').evaluate((c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let n = 0
        for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 150 && d[i] < 120) n++
        return n
      })
    }
    await win.keyboard.press('Space')
    results.push(`  meter lit pixels while playing: ${lit}`)
    if (lit < 20) throw new Error('level meter stayed dark')
  })

  await step('voiceover recording (fake microphone)', async () => {
    await win.keyboard.press('Home')
    await leftTab('Kayıt')
    await win.getByRole('button', { name: 'Kaydı başlat' }).click()
    await win.getByText('Kaydediliyor').waitFor({ timeout: 8000 })
    await win.waitForTimeout(2000)
    await win.getByRole('button', { name: 'Kaydı bitir' }).click()
    await clip('Seslendirme 1').waitFor({ timeout: 20000 })
    await shot('pro-voiceover')
  })
  await step('stabilization (vid.stab)', async () => {
    await clip('landscape.mp4').click({ position: { x: 20, y: 30 } })
    await win.locator('aside nav button').filter({ hasText: /^Video$/ }).last().click().catch(() => {})
    await win.getByRole('button', { name: 'Sabitleme' }).click()
    await win.getByRole('switch', { name: 'Titremeyi gider' }).click()
    // The switch turns on once the stabilized render is in the project.
    await win.locator('button[role="switch"][aria-label="Titremeyi gider"][aria-checked="true"]').waitFor({ timeout: 180000 })
    await win.waitForTimeout(800)
    await shot('pro-stabilized')
  })

  await step('media: remove unused, relink from folder, collect', async () => {
    const tmp = join(out, 'pro-tmp-media')
    const relinkDir = join(out, 'pro-relink')
    rmSync(tmp, { recursive: true, force: true })
    rmSync(relinkDir, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    mkdirSync(join(relinkDir, 'deep'), { recursive: true })
    const moving = join(tmp, 'relink-me.mp3')
    const spare = join(tmp, 'spare.mp3')
    copyFileSync(media.music, moving)
    copyFileSync(media.music, spare)
    await leftTab('Medya')
    await stubDialogs([moving, spare], join(out, 'unused.mp4'))
    await win.getByRole('button', { name: 'İçe Aktar' }).click()
    await win.getByText('spare.mp3').waitFor({ timeout: 15000 })
    await win.locator('[title="relink-me.mp3"]').dblclick()
    await clip('relink-me.mp3').waitFor({ timeout: 5000 })
    // spare.mp3 is not on the timeline.
    await win.getByRole('button', { name: 'Medya seçenekleri' }).click()
    await win.getByRole('menuitem', { name: /^Kullanılmayan medyayı kaldır/ }).click()
    await win.getByText('spare.mp3').waitFor({ state: 'detached', timeout: 5000 })

    // The file disappears and turns up in another folder.
    await win.waitForTimeout(1500)
    copyFileSync(moving, join(relinkDir, 'deep', 'relink-me.mp3'))
    rmSync(tmp, { recursive: true, force: true })
    await win.getByRole('button', { name: 'Projeler' }).first().click()
    await win.getByRole('heading', { name: 'Projeler', exact: true }).waitFor({ timeout: 10000 })
    await win.getByRole('button', { name: 'Adsız Proje' }).first().click()
    await win.getByText('1 dosya bulunamadı').waitFor({ timeout: 10000 })
    await shot('pro-missing-banner')
    await stubDialogs([relinkDir], join(out, 'unused.mp4'))
    await win.getByRole('button', { name: 'Klasörde ara ve bağla' }).click()
    await win.getByText('1/1 dosya yeniden bağlandı').waitFor({ timeout: 10000 })
    await win.getByText('1 dosya bulunamadı').waitFor({ state: 'detached', timeout: 5000 })

    // Fixtures live outside the project folder: copy them in.
    await win.getByRole('button', { name: 'Medya seçenekleri' }).click()
    await win.getByRole('menuitem', { name: /^Dosyaları proje klasörüne topla/ }).click()
    const toastText = await win.getByText(/dosya proje klasörüne kopyalandı/).innerText({ timeout: 15000 })
    results.push(`  collect: ${toastText}`)
    if (!/^[4-9] dosya/.test(toastText)) throw new Error(`collected: ${toastText}`)
  })

  // Each format through the real export window; the in/out range (2 s – 7 s) is on by default.
  const exportAs = async (formatLabel, file, extra) => {
    await stubDialogs([], join(out, file))
    await win.keyboard.press('Control+E')
    const dialog = win.getByRole('dialog')
    await dialog.getByRole('radio', { name: formatLabel }).click()
    if (extra) await extra(dialog)
    await dialog.getByRole('button', { name: 'Dışa Aktar' }).click()
    await win.getByText('Dışa aktarma tamamlandı').waitFor({ timeout: 300000 })
    await dialog.getByRole('button', { name: 'Kapat' }).click()
    return probe(join(out, file))
  }

  await step('export: MP4 of the in/out range', async () => {
    const info = await exportAs('Video', 'pro-range.mp4')
    const d = Number(info.format.duration)
    results.push(`  range mp4: ${d.toFixed(2)}s, ${info.streams.map((s) => s.codec_name).join('+')}`)
    if (Math.abs(d - 5) > 0.15) throw new Error(`range export lasted ${d}s`)
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '1', '-i', join(out, 'pro-range.mp4'), '-frames:v', '1', '-vf', 'scale=360:-2', join(out, 'pro-range-frame.png')])
  })

  await step('export: GIF, audio only, still frame', async () => {
    const gif = await exportAs('GIF', 'pro.gif', (d) => d.getByRole('radio', { name: /^320×/ }).click())
    const g = gif.streams[0]
    results.push(`  gif: ${g.codec_name} ${g.width}x${g.height}, ${Number(gif.format.duration).toFixed(2)}s`)
    if (g.codec_name !== 'gif' || g.width !== 320) throw new Error('bad gif')
    const mp3 = await exportAs('Yalnız ses', 'pro-audio.mp3', (d) => d.getByRole('radio', { name: 'MP3' }).click())
    results.push(`  audio: ${mp3.streams[0].codec_name}, ${Number(mp3.format.duration).toFixed(2)}s`)
    if (mp3.streams[0].codec_name !== 'mp3' || mp3.streams.some((s) => s.codec_type === 'video')) throw new Error('bad audio export')
    await win.keyboard.press('Home')
    for (let i = 0; i < 30; i++) await win.keyboard.press('ArrowRight')
    const png = await exportAs('Kare (PNG)', 'pro-still.png')
    results.push(`  still: ${png.streams[0].codec_name} ${png.streams[0].width}x${png.streams[0].height}`)
    if (png.streams[0].width !== 1080 || png.streams[0].height !== 1920) throw new Error('bad still size')
  })
  await step('tone curves', async () => {
    await clip('portrait.mp4').click({ position: { x: 20, y: 30 } })
    await win.locator('aside nav button').filter({ hasText: /^Video$/ }).last().click().catch(() => {})
    await win.getByRole('button', { name: 'Eğriler', exact: true }).click()
    await win.getByRole('button', { name: 'Kontrast (S)' }).click()
    await expectCount(win.getByTestId('curve-point'), 4, 'S-curve points')
    // Drag the upper point up a little.
    const pt = await win.getByTestId('curve-point').nth(2).boundingBox()
    await win.mouse.move(pt.x + pt.width / 2, pt.y + pt.height / 2)
    await win.mouse.down()
    await win.mouse.move(pt.x + pt.width / 2, pt.y - 15, { steps: 3 })
    await win.mouse.up()
    await win.getByRole('radio', { name: 'Mavi' }).click()
    await win.getByTestId('curve-point').first().waitFor()
    await win.waitForTimeout(400)
    await win.locator('aside').last().screenshot({ path: join(out, 'pro-curves.png') })
  })

  await step('reverse clip', async () => {
    await clip('portrait.mp4').click({ button: 'right', position: { x: 20, y: 30 } })
    await win.getByRole('menuitem', { name: 'Ters oynat' }).click()
    await win.locator('aside nav button').filter({ hasText: /^Hız$/ }).last().click().catch(() => {})
    await win.getByRole('button', { name: 'Ters oynatma' }).click()
    await win.locator('button[role="switch"][aria-label="Ters oynat"][aria-checked="true"]').waitFor({ timeout: 120000 })
    // Turning it off goes back to the original media.
    await win.getByRole('switch', { name: 'Ters oynat' }).click()
    await win.locator('button[role="switch"][aria-label="Ters oynat"][aria-checked="false"]').waitFor({ timeout: 5000 })
    await win.keyboard.press('Control+Z')
    await win.locator('button[role="switch"][aria-label="Ters oynat"][aria-checked="true"]').waitFor({ timeout: 5000 })
  })

  await step('title templates', async () => {
    await win.keyboard.press('Home')
    await leftTab('Metin')
    const before = await clips().count()
    await win.locator('button[data-template="lowerThird"]').click()
    await expectCount(clips(), before + 3, 'lower third parts')
    await win.locator('button[data-template="chapter"]').click()
    await expectCount(clips(), before + 5, 'chapter parts')
    for (let i = 0; i < 40; i++) await win.keyboard.press('ArrowRight')
    await win.waitForTimeout(700)
    await win.locator('canvas[data-canvas]').screenshot({ path: join(out, 'pro-templates.png') })
    await win.keyboard.press('Control+Z')
    await expectCount(clips(), before + 3, 'undo chapter')
  })

  await step('command palette + undo history', async () => {
    await win.keyboard.press('Control+Shift+P')
    const palette = win.getByRole('dialog', { name: 'Komut paleti' })
    await palette.getByRole('textbox').fill('panel efekt')
    await palette.getByRole('option', { name: 'Panel: Efektler' }).waitFor({ timeout: 3000 })
    await win.keyboard.press('Enter')
    await palette.waitFor({ state: 'detached', timeout: 3000 })
    await win.locator('button[data-effect="glitch"]').waitFor({ timeout: 3000 })
    // A command by name.
    await win.keyboard.press('F1')
    await palette.getByRole('textbox').fill('işaret ekle')
    await win.keyboard.press('Enter')
    await expectCount(win.getByTestId('marker'), 4, 'marker from palette')
    // History: step back two edits, then forward again.
    await win.getByRole('button', { name: 'Geçmiş' }).click()
    const rows = win.getByRole('option')
    const count = await rows.count()
    await shot('pro-history')
    await rows.nth(2).click()
    await expectCount(win.getByTestId('marker'), 3, 'marker after history jump')
    await win.keyboard.press('Control+Shift+Z')
    await win.keyboard.press('Control+Shift+Z')
    await expectCount(win.getByTestId('marker'), 4, 'marker after redo')
    results.push(`  history rows: ${count}`)
  })
  const seekTo = async (seconds, fps = 30) => {
    await win.keyboard.press('Home')
    for (let i = 0; i < Math.round(seconds * fps); i++) await win.keyboard.press('ArrowRight')
  }

  await step('new transition (iris)', async () => {
    await leftTab('Geçişler')
    await win.locator('button[aria-label="Geçiş ekle"]').first().click()
    await win.getByRole('button', { name: /Daire/ }).first().click()
    await seekTo(6)
    await win.waitForTimeout(800)
    await win.locator('canvas[data-canvas]').screenshot({ path: join(out, 'pro-iris.png') })
  })

  await step('slideshow from photos', async () => {
    await leftTab('Medya')
    await stubDialogs(media.photos, join(out, 'unused.mp4'))
    await win.getByRole('button', { name: 'İçe Aktar' }).click()
    await win.getByText('photo-c.png').waitFor({ timeout: 15000 })
    const before = await clips('image').count()
    await win.getByRole('button', { name: 'Medya seçenekleri' }).click()
    await win.getByRole('menuitem', { name: 'Fotoğraflardan slayt gösterisi' }).click()
    const dialog = win.getByRole('dialog', { name: 'Fotoğraflardan slayt gösterisi' })
    await dialog.getByText('Fotoğraflar (3 seçili)').waitFor({ timeout: 3000 })
    await dialog.getByRole('combobox', { name: 'Müzik' }).click()
    await win.getByRole('option', { name: 'music.mp3' }).click()
    await dialog.getByRole('radio', { name: 'Karışık' }).click()
    await dialog.getByRole('button', { name: 'Oluştur' }).click()
    await win.getByText('3 fotoğraflık slayt gösterisi eklendi').waitFor({ timeout: 30000 })
    await expectCount(clips('image'), before + 3, 'slides')
    await win.keyboard.press('End')
    for (let i = 0; i < 70; i++) await win.keyboard.press('ArrowLeft')
    await win.waitForTimeout(800)
    await win.locator('canvas[data-canvas]').screenshot({ path: join(out, 'pro-slideshow.png') })
  })

  await step('canvas: 4K and 25 fps, 4K still', async () => {
    const stage = await win.locator('canvas[data-canvas]').boundingBox()
    // Clicking the empty stage (clear of the selected slide's oversized frame) clears the selection.
    await win.mouse.click(stage.x - 250, stage.y + stage.height * 0.8)
    await win.getByRole('combobox', { name: 'Çözünürlük' }).click()
    await win.getByRole('option', { name: '4K · 2160×3840' }).click()
    await win.getByRole('combobox', { name: 'Kare hızı' }).click()
    await win.getByRole('option', { name: '25 fps' }).click()
    await win.getByRole('combobox', { name: 'Kare hızı' }).getByText('25 fps').waitFor({ timeout: 3000 })
    const png = await exportAs('Kare (PNG)', 'pro-still-4k.png')
    results.push(`  4K still: ${png.streams[0].width}x${png.streams[0].height}`)
    if (png.streams[0].width !== 2160 || png.streams[0].height !== 3840) throw new Error('bad 4K still')
  })
  await step('J/K/L shuttle', async () => {
    // Timecode hh:mm:ss:ff at the project's 25 fps.
    const now = async () => {
      const [h, m, sec, f] = (await win.locator('text=/^\\d\\d:\\d\\d:\\d\\d:\\d\\d$/').first().innerText()).split(':').map(Number)
      return h * 3600 + m * 60 + sec + f / 25
    }
    // Measures how far the playhead moves per second of wall time while shuttling (two-second
    // window, so a late screen update at either end matters less).
    const speed = async () => {
      const a = await now()
      const t0 = Date.now()
      await win.waitForTimeout(2000)
      const b = await now()
      return (b - a) / ((Date.now() - t0) / 1000)
    }
    await win.keyboard.press('Home')
    await win.keyboard.press('l')
    await win.waitForTimeout(300)
    const normal = await speed()
    await win.keyboard.press('l')
    await win.getByTestId('shuttle').getByText('2×').waitFor({ timeout: 2000 })
    const double = await speed()
    await win.keyboard.press('j')
    await win.getByTestId('shuttle').getByText('1×').waitFor({ timeout: 2000 })
    const reverse = await speed()
    await win.keyboard.press('k')
    results.push(`  shuttle speed: L ${normal.toFixed(2)}×, L L ${double.toFixed(2)}×, J ${reverse.toFixed(2)}×`)
    if (Math.abs(normal - 1) > 0.25 || Math.abs(double - 2) > 0.4 || Math.abs(reverse + 1) > 0.3) throw new Error('shuttle speeds off')
  })

  await step('settings: show what is new again', async () => {
    await win.getByRole('button', { name: 'Ayarlar', exact: true }).click()
    await win.getByRole('button', { name: 'Hakkında' }).click()
    await win.getByRole('button', { name: 'Yenilikleri göster' }).click()
    await win.getByRole('dialog', { name: 'Maker 0.5’te neler var?' }).waitFor({ timeout: 3000 })
    await win.getByRole('button', { name: 'Başlayalım' }).click()
    await win.keyboard.press('Escape')
  })

} finally {
  results.push(...errors.map((e) => `  ${e}`))
  console.log(results.join('\n'))
  await app.close()
}
