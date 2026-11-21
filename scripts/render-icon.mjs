// Renders build/icon.png (512×512) from the SVG below using Electron's off-screen renderer.
// Run: npx electron scripts/render-icon.mjs   (no window is shown)
import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" style="display:block;width:100vw;height:100vh">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b3b40"/>
      <stop offset="1" stop-color="#151517"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#4aa3ff"/>
      <stop offset="1" stop-color="#0a84ff"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="204" fill="url(#bg)"/>
  <rect x="65" y="65" width="894" height="894" rx="203" fill="none" stroke="#ffffff" stroke-opacity="0.13" stroke-width="2"/>
  <rect x="196" y="318" width="430" height="104" rx="34" fill="#f5f5f7" fill-opacity="0.94"/>
  <rect x="300" y="460" width="528" height="104" rx="34" fill="url(#accent)"/>
  <rect x="196" y="602" width="340" height="104" rx="34" fill="#f5f5f7" fill-opacity="0.5"/>
  <rect x="664" y="250" width="16" height="530" rx="8" fill="#ffffff"/>
  <circle cx="672" cy="246" r="32" fill="#ffffff"/>
</svg>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;overflow:hidden;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 400))
  const captured = await win.webContents.capturePage()
  // The captured area may not be square (DPI scaling); keep the centred square.
  const { width, height } = captured.getSize()
  const side = Math.min(width, height)
  const image = captured.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'icon.png'), image.resize({ width: 512, height: 512, quality: 'best' }).toPNG())
  console.log('wrote', join(out, 'icon.png'))
  app.quit()
})
