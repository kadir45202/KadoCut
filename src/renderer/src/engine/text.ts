import type { TextClip, TextStyle } from '@shared/project/schema'

/**
 * Text layout + rasterization shared by preview and export, so captions look identical in both.
 * All sizes are canvas (project) pixels.
 */

export interface TextWord {
  text: string
  /** Index into clip.words for caption highlighting (-1 for plain text). */
  index: number
  x: number
  width: number
}

export interface TextLine {
  words: TextWord[]
  width: number
}

export interface TextLayout {
  width: number
  height: number
  fontPx: number
  lineHeightPx: number
  padding: number
  lines: TextLine[]
}

let locale = 'tr'
/** Locale for case mapping (Turkish i/İ). */
export function setTextLocale(next: string) {
  locale = next
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
function measurer(): OffscreenCanvasRenderingContext2D {
  measureCtx ??= new OffscreenCanvas(8, 8).getContext('2d')!
  return measureCtx
}

export const fontFor = (style: TextStyle, px: number) => `${style.fontWeight} ${px}px "${style.fontFamily}", "Segoe UI", sans-serif`

function applyFont(ctx: OffscreenCanvasRenderingContext2D, style: TextStyle, px: number) {
  ctx.font = fontFor(style, px)
  ctx.letterSpacing = `${style.letterSpacing * px}px`
}

const layoutCache = new Map<string, TextLayout>()

/** Drops cached measurements (call when web fonts finish loading). */
export const clearTextLayoutCache = () => layoutCache.clear()

function tokens(clip: TextClip): { text: string; index: number; breakBefore: boolean }[] {
  const upper = (s: string) => (clip.style.uppercase ? s.toLocaleUpperCase(locale) : s)
  if (clip.words.length) return clip.words.map((w, i) => ({ text: upper(w.text), index: i, breakBefore: false }))
  const out: { text: string; index: number; breakBefore: boolean }[] = []
  for (const [p, paragraph] of upper(clip.text).split('\n').entries()) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) out.push({ text: '', index: -1, breakBefore: p > 0 })
    words.forEach((w, i) => out.push({ text: w, index: -1, breakBefore: p > 0 && i === 0 }))
  }
  return out
}

export function layoutText(clip: TextClip, canvasW: number, canvasH: number): TextLayout {
  const key = `${canvasW}x${canvasH}|${locale}|${clip.text}|${clip.words.length ? clip.words.map((w) => w.text).join(' ') : ''}|${JSON.stringify(clip.style)}`
  const cached = layoutCache.get(key)
  if (cached) return cached

  const { style } = clip
  const fontPx = style.fontSize * canvasH
  // Bundled / user fonts load on first use; the preview re-renders when they arrive.
  if (typeof document !== 'undefined' && !document.fonts.check(fontFor(style, 20))) void document.fonts.load(fontFor(style, 20)).catch(() => {})
  const ctx = measurer()
  applyFont(ctx, style, fontPx)
  const space = ctx.measureText(' ').width
  const maxWidth = style.maxWidth * canvasW
  const lines: TextLine[] = []
  let line: TextLine = { words: [], width: 0 }

  for (const tok of tokens(clip)) {
    const w = tok.text ? ctx.measureText(tok.text).width : 0
    const nextWidth = line.words.length ? line.width + space + w : w
    if (tok.breakBefore || (line.words.length && nextWidth > maxWidth)) {
      lines.push(line)
      line = { words: [], width: 0 }
    }
    if (tok.text) {
      const x = line.words.length ? line.width + space : 0
      line.words.push({ text: tok.text, index: tok.index, x, width: w })
      line.width = x + w
    }
  }
  lines.push(line)

  const lineHeightPx = fontPx * style.lineHeight
  const stroke = style.strokeWidth * fontPx
  let padding = style.backgroundOpacity > 0 ? fontPx * 0.35 : stroke + (style.shadow ? fontPx * 0.12 : 0)
  // Room for the highlight box / enlarged word around caption words.
  if (clip.words.length && (style.highlightMode === 'box' || style.highlightMode === 'scale')) padding = Math.max(padding, fontPx * 0.22)
  const width = Math.max(1, ...lines.map((l) => l.width)) + padding * 2
  const height = Math.max(1, lines.length) * lineHeightPx + padding * 2
  const layout = { width, height, fontPx, lineHeightPx, padding, lines }
  if (layoutCache.size > 300) layoutCache.clear()
  layoutCache.set(key, layout)
  return layout
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/** What part of a text clip is visible at a moment (caption progress, typewriter). */
export interface TextState {
  /** Active caption word index (-1 for none). */
  highlight: number
  /** Caption words already spoken (reveal = 'word'); Infinity shows all. */
  revealed: number
  /** Characters typed so far (typewriter); Infinity shows all. */
  chars: number
}

export const FULL_TEXT: TextState = { highlight: -1, revealed: Infinity, chars: Infinity }

export const textStateKey = (st: TextState) => `${st.highlight}|${st.revealed}|${st.chars}`

/** Rasterizes a text layout at `scale` (texture pixels per canvas pixel) into a 2D canvas. */
export function rasterizeText(clip: TextClip, layout: TextLayout, state: TextState, scale: number): OffscreenCanvas {
  const { highlight } = state
  const { style } = clip
  const w = Math.max(1, Math.ceil(layout.width * scale))
  const h = Math.max(1, Math.ceil(layout.height * scale))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  const fontPx = layout.fontPx

  if (style.backgroundOpacity > 0) {
    ctx.fillStyle = hexToRgba(style.backgroundColor, style.backgroundOpacity)
    ctx.beginPath()
    ctx.roundRect(0, 0, layout.width, layout.height, fontPx * 0.25)
    ctx.fill()
  }

  applyFont(ctx, style, fontPx)
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const stroke = style.strokeWidth * fontPx
  const inner = layout.width - layout.padding * 2

  let typed = 0
  layout.lines.forEach((line, i) => {
    const offset = style.align === 'left' ? 0 : style.align === 'right' ? inner - line.width : (inner - line.width) / 2
    const y = layout.padding + i * layout.lineHeightPx + layout.lineHeightPx / 2
    for (const word of line.words) {
      if (word.index >= state.revealed) continue
      let text = word.text
      if (typed >= state.chars) return
      if (typed + text.length > state.chars) text = text.slice(0, Math.floor(state.chars - typed))
      typed += word.text.length + 1
      const x = layout.padding + offset + word.x
      const active = word.index >= 0 && word.index === highlight
      ctx.save()
      if (active && style.highlightMode === 'box') {
        const padX = fontPx * 0.14
        ctx.fillStyle = style.highlightColor
        ctx.beginPath()
        ctx.roundRect(x - padX, y - fontPx * 0.62, word.width + padX * 2, fontPx * 1.24, fontPx * 0.18)
        ctx.fill()
      }
      if (active && style.highlightMode === 'scale') {
        // Enlarge the spoken word about its centre.
        const cx = x + word.width / 2
        ctx.translate(cx, y)
        ctx.scale(1.18, 1.18)
        ctx.translate(-cx, -y)
      }
      if (style.shadow) {
        ctx.save()
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = fontPx * 0.12
        ctx.shadowOffsetY = fontPx * 0.04
        ctx.fillStyle = 'rgba(0,0,0,0.01)'
        ctx.fillText(text, x, y)
        ctx.restore()
      }
      if (stroke > 0) {
        ctx.strokeStyle = style.strokeColor
        ctx.lineWidth = stroke * 2
        ctx.strokeText(text, x, y)
      }
      const colored = active && (style.highlightMode === 'color' || style.highlightMode === 'scale')
      ctx.fillStyle = colored ? style.highlightColor : style.color
      ctx.fillText(text, x, y)
      ctx.restore()
    }
  })
  return canvas
}
