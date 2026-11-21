import type { Project, ShapeClip, TextClip, VideoClip } from '@shared/project/schema'
import { rateAt } from '@renderer/core/project/speed'
import { projectDuration } from '@renderer/core/project/timeline'
import { ensureAudio, ensureProxy, ensureStretch, stretchKey, useMedia } from '@renderer/core/media/media'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { useProject } from '@renderer/core/store/project'
import { useSettings } from '@renderer/core/store/settings'
import { log, mediaUrl } from '@renderer/lib/api'
import { audioPathFor, loadedPcm, needsStretch, scheduleAudio, soundClips, warmPcm, type AudioResolver } from './audio'
import { Compositor, type DrawItem, type LayerSource } from './compositor'
import { expandCompounds } from './expand'
import { evaluateFrame, extendedSourceTime, pixelSource, type VisualLayer } from './scene'
import { loadLut, loadedLut } from './lut'
import { rasterizeShape, shapeKey } from './shapes'
import { frameFlash, visibleRange } from './transitions'
import { clearTextLayoutCache, rasterizeText, textStateKey } from './text'

export const QUALITY_SCALE = { full: 1, half: 0.5, quarter: 0.25 } as const
export type PreviewQuality = keyof typeof QUALITY_SCALE

interface VideoSlot {
  el: HTMLVideoElement
  /** File currently loaded (original, proxy or alpha render). */
  path: string
  /** Original asset path, used to request a proxy if decoding fails. */
  original: string
  lastSeek: number
}

const PREROLL = 1.5
const DRIFT_LIMIT = 0.15

/**
 * Realtime preview: drives HTMLVideoElements in sync with the Web Audio clock and composites
 * them with the shared WebGL compositor. Owned by the Viewer; one instance at a time.
 */
export class PreviewEngine {
  readonly compositor: Compositor
  private slots = new Map<string, VideoSlot>()
  private images = new Map<string, { bitmap?: ImageBitmap; failed?: boolean }>()
  private texts = new Map<string, { key: string; canvas: OffscreenCanvas; version: number }>()
  private textVersion = 1
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private analysers: AnalyserNode[] = []
  private outputMuted = false
  private meterBuf = new Float32Array(1024)
  private sources: AudioBufferSourceNode[] = []
  private playing = false
  /** Shuttle speed: 1 = normal play (with sound), 2/4/8 faster, negative = backwards (silent). */
  private rate = 1
  private clockStart = 0
  private timeStart = 0
  private raf = 0
  private renderQueued = false
  private scale: number = QUALITY_SCALE.half
  private unsubs: (() => void)[] = []

  constructor(readonly canvas: HTMLCanvasElement) {
    this.compositor = new Compositor(canvas, { preserveDrawingBuffer: true })
    this.unsubs.push(
      useProject.subscribe((s, prev) => {
        if (s.project !== prev.project) this.onProjectChange()
      }),
      useMedia.subscribe(() => {
        this.requestRender()
        if (this.playing) this.warm()
      })
    )
    this.warm()
    this.requestRender()
    document.fonts.addEventListener('loadingdone', this.onFontsLoaded)
  }

  /** Text measured with a fallback font must be laid out again once the real font arrives. */
  private onFontsLoaded = () => {
    clearTextLayoutCache()
    this.texts.clear()
    this.requestRender()
  }

  /** Rendering view of the open project (compound clips flattened). */
  private get project(): Project | null {
    const p = useProject.getState().project
    return p ? expandCompounds(p) : null
  }

  setQuality(q: PreviewQuality) {
    this.scale = QUALITY_SCALE[q]
    this.requestRender()
  }

  get isPlaying() {
    return this.playing
  }

  /** Playback speed while playing (see `shuttle`). */
  get speed(): number {
    return this.playing ? this.rate : 0
  }

  /** Current timeline time (audio clock while playing). */
  get time(): number {
    if (!this.playing || !this.ctx) return useEditor.getState().playhead
    return this.timeStart + Math.max(0, this.ctx.currentTime - this.clockStart) * this.rate
  }

  // ---------------------------------------------------------------- transport

  async play(rate = 1) {
    const p = this.project
    if (!p) return
    if (this.playing) return this.setRate(rate)
    const duration = projectDuration(p)
    if (duration <= 0) return
    let t = useEditor.getState().playhead
    if (rate > 0 && t >= duration - 1e-3) t = 0
    if (rate < 0 && t <= 1e-3) return
    this.rate = rate
    const ctx = this.audio()
    await ctx.resume()
    // Give buffers that are already decoding a moment to arrive before starting.
    await Promise.race([this.warm(), new Promise((r) => setTimeout(r, 250))])
    this.timeStart = t
    this.clockStart = ctx.currentTime + 0.05
    this.playing = true
    useEditor.setState({ playing: true, playhead: t })
    this.reschedule()
    this.syncVideos(t, rate > 0)
    this.raf = requestAnimationFrame(this.loop)
  }

  /** J / L: play backwards / forwards; pressing the same key again doubles the speed (up to 8×). */
  shuttle(dir: 1 | -1) {
    const next = this.playing && Math.sign(this.rate) === dir ? dir * Math.min(8, Math.abs(this.rate) * 2) : dir
    void this.play(next)
  }

  private setRate(rate: number) {
    if (!this.ctx || rate === this.rate) return
    this.timeStart = this.time
    this.clockStart = this.ctx.currentTime
    this.rate = rate
    this.reschedule()
    for (const slot of this.slots.values()) slot.lastSeek = 0
  }

  pause() {
    if (!this.playing) return
    const t = this.time
    this.playing = false
    this.rate = 1
    cancelAnimationFrame(this.raf)
    this.stopAudio()
    for (const slot of this.slots.values()) slot.el.pause()
    useEditor.setState({ playing: false, playhead: t })
    this.requestRender()
  }

  toggle() {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(t: number) {
    const p = this.project
    const max = p ? projectDuration(p) : 0
    const time = Math.min(Math.max(0, t), max)
    editorActions.setPlayhead(time)
    if (this.playing && this.ctx) {
      this.timeStart = time
      this.clockStart = this.ctx.currentTime + 0.03
      this.reschedule()
      for (const slot of this.slots.values()) slot.lastSeek = 0
    }
    this.requestRender()
  }

  private loop = () => {
    if (!this.playing) return
    const p = this.project
    if (!p) return this.pause()
    const t = this.time
    const duration = projectDuration(p)
    if (t >= duration) {
      this.pause()
      editorActions.setPlayhead(duration)
      return
    }
    if (t <= 0 && this.rate < 0) {
      this.pause()
      editorActions.setPlayhead(0)
      return
    }
    useEditor.setState({ playhead: t })
    // Backwards: videos cannot play in reverse, so they follow by seeking.
    this.syncVideos(t, this.rate > 0)
    this.renderNow(t)
    this.raf = requestAnimationFrame(this.loop)
  }

  private onProjectChange() {
    if (this.playing) this.reschedule()
    this.warm()
    this.requestRender()
  }

  // ---------------------------------------------------------------- audio

  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: 48_000, latencyHint: 'interactive' })
      this.master = this.ctx.createGain()
      this.master.gain.value = this.outputMuted ? 0 : 1
      // Peak meters tap the mix on its way out (left / right).
      const ctx = this.ctx
      const split = ctx.createChannelSplitter(2)
      const merge = ctx.createChannelMerger(2)
      this.master.connect(split)
      this.analysers = [0, 1].map((ch) => {
        const a = ctx.createAnalyser()
        a.fftSize = 1024
        split.connect(a, ch)
        a.connect(merge, 0, ch)
        return a
      })
      merge.connect(ctx.destination)
    }
    return this.ctx
  }

  /** Silences the preview mix (e.g. while recording a voiceover through speakers). */
  setOutputMuted(muted: boolean) {
    this.outputMuted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 1
  }

  /** Peak level of the playing mix per channel in dBFS (-Infinity when silent or paused). */
  levels(): [number, number] {
    if (!this.playing || this.analysers.length < 2) return [-Infinity, -Infinity]
    const [l, r] = this.analysers.map((a) => {
      a.getFloatTimeDomainData(this.meterBuf)
      let peak = 0
      for (const v of this.meterBuf) peak = Math.max(peak, Math.abs(v))
      return 20 * Math.log10(peak)
    })
    return [l, r]
  }

  private stopAudio() {
    for (const s of this.sources) {
      try {
        s.stop()
        s.disconnect()
      } catch {
        // already stopped
      }
    }
    this.sources = []
  }

  private resolve: AudioResolver = (clip) => {
    const p = this.project
    if (!p) return null
    const path = audioPathFor(p, clip)
    if (!path) return null
    const rate = needsStretch(clip)
    if (rate) {
      const st = useMedia.getState().stretch[stretchKey(path, rate)]
      if (st?.status === 'ready' && st.path) {
        const buffer = loadedPcm(st.path)
        if (buffer) return { buffer, stretchedRate: rate }
      }
      // Until the stretched render exists, play pitch-shifted rather than silent.
    }
    const info = useMedia.getState().audio[path]
    const buffer = info?.data ? loadedPcm(info.data.pcmPath) : undefined
    return buffer ? { buffer, stretchedRate: null } : null
  }

  private reschedule() {
    const p = this.project
    if (!p || !this.ctx || !this.master) return
    this.stopAudio()
    // Sound only plays at normal speed.
    if (this.rate !== 1) return
    const when = this.ctx.currentTime + 0.03
    const from = this.timeStart + Math.max(0, when - this.clockStart)
    this.sources = scheduleAudio(this.ctx, this.master, p, from, when, this.resolve)
  }

  private warming = new Set<string>()

  /** Makes sure every audible clip has decoded audio loaded; reschedules when new ones arrive. */
  private warm(): Promise<unknown> {
    const p = this.project
    if (!p) return Promise.resolve()
    const pending: Promise<unknown>[] = []
    const media = useMedia.getState()
    const load = (pcm: string) => {
      if (loadedPcm(pcm) || this.warming.has(pcm)) return
      this.warming.add(pcm)
      pending.push(
        warmPcm(pcm)
          .then(() => this.playing && this.reschedule())
          .catch((err) => log.warn('preview', `audio load failed: ${String(err)}`))
          .finally(() => this.warming.delete(pcm))
      )
    }
    for (const clip of soundClips(p)) {
      const path = audioPathFor(p, clip)
      if (!path) continue
      const info = media.audio[path]
      if (!info) ensureAudio(path)
      else if (info.data) load(info.data.pcmPath)
      const rate = needsStretch(clip)
      if (rate) {
        const st = media.stretch[stretchKey(path, rate)]
        if (!st) ensureStretch(path, rate)
        else if (st.path) load(st.path)
      }
    }
    return Promise.all(pending)
  }

  // ---------------------------------------------------------------- video

  private pathFor(p: Project, clip: VideoClip): { path: string; original: string } {
    const { asset } = pixelSource(p, clip)
    const original = asset?.path ?? ''
    // Optional: preview high-resolution footage from a lighter copy (made once, cached).
    if (asset && asset.width * asset.height > 1920 * 1088 && useSettings.getState().settings.proxyLarge) ensureProxy(original)
    const proxy = useMedia.getState().proxy[original]
    return { path: proxy?.status === 'ready' && proxy.path ? proxy.path : original, original }
  }

  private slotFor(p: Project, clip: VideoClip): VideoSlot {
    const { path, original } = this.pathFor(p, clip)
    let slot = this.slots.get(clip.id)
    if (slot && slot.path === path) return slot
    if (slot) this.release(clip.id)
    const el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.muted = true
    el.preload = 'auto'
    el.playsInline = true
    el.disablePictureInPicture = true
    el.src = mediaUrl(path)
    el.addEventListener('loadeddata', () => this.requestRender())
    el.addEventListener('seeked', () => this.requestRender())
    el.addEventListener('error', () => {
      log.warn('preview', `cannot decode ${path} (${el.error?.code}); requesting proxy`)
      if (path === original) ensureProxy(original)
    })
    slot = { el, path, original, lastSeek: 0 }
    this.slots.set(clip.id, slot)
    return slot
  }

  private release(clipId: string) {
    const slot = this.slots.get(clipId)
    if (!slot) return
    slot.el.pause()
    slot.el.removeAttribute('src')
    slot.el.load()
    this.slots.delete(clipId)
  }

  private syncVideos(t: number, playing: boolean) {
    const p = this.project
    if (!p) return
    const keep = new Set<string>()
    const hidden = new Set(p.tracks.filter((tr) => tr.hidden).map((tr) => tr.id))
    for (const clip of Object.values(p.clips)) {
      if (clip.kind !== 'video' || hidden.has(clip.trackId)) continue
      // Transitions draw a clip slightly before its start / after its end.
      const [from, to] = visibleRange(p, clip)
      if (t < from - PREROLL || t >= to + 0.25) continue
      keep.add(clip.id)
      const slot = this.slotFor(p, clip)
      const el = slot.el
      const inside = t >= from && t < to
      const mediaDuration = p.assets[clip.assetId]?.duration ?? 0
      const target = extendedSourceTime(clip, inside ? t : from, mediaDuration)
      if (playing && inside) {
        const local = Math.min(Math.max(t - clip.start, 0), clip.duration)
        const rate = Math.min(16, Math.max(0.0625, rateAt(clip.speed, clip.duration, local) * this.rate))
        if (Math.abs(el.playbackRate - rate) > 0.005) el.playbackRate = rate
        if (el.paused) el.play().catch(() => {})
        const now = performance.now()
        if (Math.abs(el.currentTime - target) > DRIFT_LIMIT && now - slot.lastSeek > 300 && !el.seeking) {
          el.currentTime = target
          slot.lastSeek = now
        }
      } else {
        if (!el.paused) el.pause()
        const tolerance = playing ? 0.05 : 0.4 / p.settings.fps
        if (Math.abs(el.currentTime - target) > tolerance && !el.seeking) el.currentTime = target
      }
    }
    for (const id of [...this.slots.keys()]) if (!keep.has(id)) this.release(id)
  }

  // ---------------------------------------------------------------- render

  /** Called right after each rendered frame, while the canvas still holds it (colour scopes). */
  readonly frameListeners = new Set<(canvas: HTMLCanvasElement) => void>()

  requestRender() {
    if (this.playing || this.renderQueued) return
    this.renderQueued = true
    requestAnimationFrame(() => {
      this.renderQueued = false
      if (this.playing) return
      const t = useEditor.getState().playhead
      this.syncVideos(t, false)
      this.renderNow(t)
    })
  }

  private imageSource(path: string): LayerSource | null {
    const entry = this.images.get(path)
    if (entry?.bitmap) return { kind: 'element', source: entry.bitmap, width: entry.bitmap.width, height: entry.bitmap.height, version: 1 }
    if (!entry) {
      this.images.set(path, {})
      fetch(mediaUrl(path))
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
        .then((bitmap) => {
          this.images.set(path, { bitmap })
          this.requestRender()
        })
        .catch((err) => {
          log.warn('preview', `image load failed ${path}: ${String(err)}`)
          this.images.set(path, { failed: true })
        })
    }
    return null
  }

  /** Rasterization scale near display resolution, quantized so scale animation doesn't redraw every frame. */
  private rasterScale(layer: VisualLayer, scale: number) {
    const raw = scale * Math.hypot(layer.matrix[0], layer.matrix[1])
    return Math.min(4, Math.max(0.1, 2 ** (Math.round(Math.log2(raw) * 4) / 4)))
  }

  private cachedRaster(id: string, key: string, draw: () => OffscreenCanvas): LayerSource {
    let entry = this.texts.get(id)
    if (!entry || entry.key !== key) {
      entry = { key, canvas: draw(), version: this.textVersion++ }
      this.texts.set(id, entry)
    }
    return { kind: 'element', source: entry.canvas, width: entry.canvas.width, height: entry.canvas.height, version: entry.version }
  }

  private textSource(clip: TextClip, layer: VisualLayer, scale: number): LayerSource | null {
    const { text, textState } = layer
    if (!text || !textState) return null
    const k = this.rasterScale(layer, scale)
    const key = `${JSON.stringify(text.lines.map((l) => l.words.map((w) => w.text)))}|${JSON.stringify(clip.style)}|${textStateKey(textState)}|${k}`
    return this.cachedRaster(clip.id, key, () => rasterizeText(clip, text, textState, k))
  }

  private shapeSource(clip: ShapeClip, layer: VisualLayer, scale: number): LayerSource {
    const k = this.rasterScale(layer, scale)
    const progress = Math.round(layer.progress * 1000) / 1000
    const key = `${shapeKey(clip, layer)}|${progress}|${k}`
    return this.cachedRaster(clip.id, key, () => rasterizeShape(clip, layer.width, layer.height, progress, k))
  }

  private renderNow(t: number) {
    const p = this.project
    if (!p) return
    const scale = this.scale
    const w = Math.max(2, Math.round((p.settings.width * scale) / 2) * 2)
    const h = Math.max(2, Math.round((p.settings.height * scale) / 2) * 2)
    this.compositor.resize(w, h)
    const items: DrawItem[] = []
    for (const layer of evaluateFrame(p, t)) {
      let source: LayerSource | null = null
      if (layer.clip.kind === 'video') {
        const el = this.slots.get(layer.clip.id)?.el
        if (el && el.readyState >= 2 && el.videoWidth) source = { kind: 'element', source: el, width: el.videoWidth, height: el.videoHeight, version: -1 }
      } else if (layer.clip.kind === 'image') {
        if (layer.asset) source = this.imageSource(layer.asset.path)
      } else if (layer.clip.kind === 'text') {
        source = this.textSource(layer.clip, layer, scale)
      } else if (layer.clip.kind === 'shape') {
        source = this.shapeSource(layer.clip, layer, scale)
      } else {
        source = { kind: 'backdrop' }
      }
      if (source) items.push({ layer, source, lut: this.lutFor(layer) })
    }
    try {
      this.compositor.render(items, p.settings.background, scale, frameFlash(p, t))
      for (const fn of this.frameListeners) fn(this.canvas)
    } catch (err) {
      log.error('preview', 'render failed', err)
    }
  }

  private lutFor(layer: VisualLayer) {
    if (!layer.lutPath) return undefined
    const lut = loadedLut(layer.lutPath)
    if (!lut) {
      loadLut(layer.lutPath)
        .then(() => this.requestRender())
        .catch((err) => log.warn('preview', `LUT load failed: ${String(err)}`))
    }
    return lut
  }

  /** JPEG of the current frame for the project thumbnail. */
  captureThumbnail(maxSize = 480): string | null {
    const { width, height } = this.canvas
    if (!width || !height) return null
    const k = Math.min(1, maxSize / Math.max(width, height))
    const c = document.createElement('canvas')
    c.width = Math.round(width * k)
    c.height = Math.round(height * k)
    c.getContext('2d')!.drawImage(this.canvas, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.82)
  }

  dispose() {
    this.pause()
    cancelAnimationFrame(this.raf)
    for (const u of this.unsubs) u()
    document.fonts.removeEventListener('loadingdone', this.onFontsLoaded)
    for (const id of [...this.slots.keys()]) this.release(id)
    for (const img of this.images.values()) img.bitmap?.close()
    this.compositor.dispose()
    void this.ctx?.close()
  }
}

let current: PreviewEngine | null = null
export const setPreview = (engine: PreviewEngine | null) => (current = engine)
export const getPreview = () => current

/** Seeks the preview (or just the playhead when no viewer is mounted). */
export function seek(t: number) {
  if (current) current.seek(t)
  else editorActions.setPlayhead(t)
}
