import type { ExportSession } from '@shared/api'
import type { Project, ShapeClip, TextClip, VideoClip } from '@shared/project/schema'
import { projectDuration } from '@renderer/core/project/timeline'
import { stretchKey } from '@renderer/core/media/media'
import { mediaUrl } from '@renderer/lib/api'
import { SAMPLE_RATE, audioPathFor, loadPcm, needsStretch, scheduleAudio, type AudioResolver } from '../audio'
import { Compositor, type DrawItem, type LayerSource } from '../compositor'
import { registerFontFiles } from '@renderer/core/fonts/fonts'
import { expandCompounds } from '../expand'
import { normalizeLoudness } from '../loudness'
import { evaluateFrame, extendedSourceTime, type VisualLayer } from '../scene'
import { loadLut, loadedLut } from '../lut'
import { rasterizeShape, shapeKey } from '../shapes'
import { frameFlash, visibleRange } from '../transitions'
import { fontFor, rasterizeText, setTextLocale, textStateKey } from '../text'

interface Decoder {
  id: number
  start: number
  fps: number
  width: number
  height: number
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Largest scale a clip reaches (static value or any keyframe). */
function maxScale(clip: VideoClip): number {
  const s = clip.transform.scale
  return Math.max(s.value, ...s.keys.map((k) => k.v), 0.01)
}

async function loadFonts(project: Project) {
  const styles = Object.values(project.clips).filter((c): c is TextClip => c.kind === 'text')
  await Promise.all(styles.map((c) => document.fonts.load(fontFor(c.style, 40), c.text || 'Aa').catch(() => [])))
  await document.fonts.ready
}

async function renderAudio(session: ExportSession, project: Project, from: number, duration: number): Promise<Float32Array[]> {
  const { request } = session
  const buffers = new Map<string, AudioBuffer>()
  for (const pcm of new Set(Object.values(request.audio))) buffers.set(pcm, await loadPcm(pcm))
  const resolve: AudioResolver = (clip) => {
    const path = audioPathFor(project, clip)
    if (!path) return null
    const rate = needsStretch(clip)
    if (rate) {
      const pcm = request.audio[stretchKey(path, rate)]
      if (pcm && buffers.has(pcm)) return { buffer: buffers.get(pcm)!, stretchedRate: rate }
    }
    const pcm = request.audio[path]
    return pcm && buffers.has(pcm) ? { buffer: buffers.get(pcm)!, stretchedRate: null } : null
  }
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * SAMPLE_RATE)), SAMPLE_RATE)
  scheduleAudio(ctx, ctx.destination, project, from, 0, resolve)
  const rendered = await ctx.startRendering()
  const channels = [rendered.getChannelData(0), rendered.getChannelData(1)]
  const { loudness } = project.settings
  if (loudness.enabled) normalizeLoudness(channels, SAMPLE_RATE, loudness.target)
  return channels
}

/**
 * Entry point of the hidden export window. Renders every frame with the same scene evaluation
 * and compositor as the preview, decoding sources frame-accurately through ffmpeg.
 */
export async function runExport() {
  const bridge = window.makerExport
  if (!bridge) return
  let cancelled = false
  bridge.onCancel(() => (cancelled = true))

  try {
    const session = await bridge.session()
    const { request } = session
    const project = expandCompounds(session.project)
    setTextLocale(request.locale)
    await registerFontFiles(request.fonts)
    await loadFonts(project)
    for (const asset of Object.values(project.assets)) if (asset.kind === 'lut') await loadLut(asset.path)

    // Whole timeline, the in/out range, or the single frame of a still.
    const full = projectDuration(project)
    const from = request.range ? Math.max(0, Math.min(full, request.range.start)) : 0
    const to = request.range ? Math.min(full, request.range.end) : full
    const duration = to - from
    if (duration <= 0) throw new Error('The project is empty')
    const totalFrames = request.format === 'png' ? 1 : Math.max(1, Math.round(duration * request.fps))

    bridge.progress(0.01, 'audio')
    const withAudio = request.format === 'mp4' || request.format === 'audio'
    const audioPath = withAudio ? await bridge.writeAudio(await renderAudio(session, project, from, duration), SAMPLE_RATE) : ''
    if (request.format === 'audio') {
      await bridge.openEncoder(audioPath)
      bridge.progress(0.9, 'finalize')
      await bridge.finishEncoder()
      return bridge.done({ path: request.outputPath, seconds: duration, encoder: 'audio' })
    }

    const canvas = document.createElement('canvas')
    const compositor = new Compositor(canvas, { preserveDrawingBuffer: true })
    compositor.resize(request.width, request.height)
    // Same aspect: plain scale. Other aspects: crop to fill or fit inside, centred.
    const sx = request.width / project.settings.width
    const sy = request.height / project.settings.height
    const scale = request.fit === 'fill' ? Math.max(sx, sy) : Math.min(sx, sy)
    const offset: [number, number] = [(request.width - project.settings.width * scale) / 2, (request.height - project.settings.height * scale) / 2]
    await bridge.openEncoder(audioPath)

    const decoders = new Map<string, Decoder>()
    const images = new Map<string, ImageBitmap>()
    const texts = new Map<string, { key: string; canvas: OffscreenCanvas; version: number }>()
    let textVersion = 1
    const pixels = new Uint8Array(request.width * request.height * 4)

    const videoSource = async (layer: VisualLayer, clip: VideoClip): Promise<LayerSource | null> => {
      const asset = layer.asset
      if (!asset) return null
      let dec = decoders.get(clip.id)
      if (!dec) {
        // Decode at (at most) the size the clip is shown at, to keep the pipe light.
        const baseW = project.assets[clip.assetId]?.width || asset.width
        const baseH = project.assets[clip.assetId]?.height || asset.height
        const fit = Math.min(project.settings.width / baseW, project.settings.height / baseH)
        const displayW = baseW * fit * maxScale(clip) * scale
        const k = Math.min(1, (displayW * 1.05) / asset.width)
        const width = even(asset.width * k)
        const height = even(asset.height * k)
        const fps = asset.fps > 0 ? asset.fps : 30
        // Start where the clip first appears (earlier than `in` when a transition leads into it).
        const start = extendedSourceTime(clip, Math.max(visibleRange(project, clip)[0], from), project.assets[clip.assetId]?.duration ?? 0)
        const id = await bridge.openDecoder({ path: asset.path, start, fps, width, height, alpha: layer.alpha })
        dec = { id, start, fps, width, height }
        decoders.set(clip.id, dec)
      }
      const index = Math.max(0, Math.floor((layer.sourceTime - dec.start) * dec.fps + 1e-3))
      const data = await bridge.readFrame(dec.id, index)
      return data ? { kind: 'pixels', data, width: dec.width, height: dec.height, version: -1 } : null
    }

    const imageSource = async (path: string): Promise<LayerSource> => {
      let bitmap = images.get(path)
      if (!bitmap) {
        bitmap = await createImageBitmap(await (await fetch(mediaUrl(path))).blob())
        images.set(path, bitmap)
      }
      return { kind: 'element', source: bitmap, width: bitmap.width, height: bitmap.height, version: 1 }
    }

    const raster = (id: string, key: string, draw: () => OffscreenCanvas): LayerSource => {
      let entry = texts.get(id)
      if (!entry || entry.key !== key) {
        entry = { key, canvas: draw(), version: textVersion++ }
        texts.set(id, entry)
      }
      return { kind: 'element', source: entry.canvas, width: entry.canvas.width, height: entry.canvas.height, version: entry.version }
    }
    const rasterScale = (layer: VisualLayer) => Math.max(0.05, Math.round(scale * Math.hypot(layer.matrix[0], layer.matrix[1]) * 100) / 100)

    const textSource = (layer: VisualLayer, clip: TextClip): LayerSource | null => {
      const { text, textState } = layer
      if (!text || !textState) return null
      const k = rasterScale(layer)
      return raster(clip.id, `${textStateKey(textState)}|${k}`, () => rasterizeText(clip, text, textState, k))
    }

    const shapeSource = (layer: VisualLayer, clip: ShapeClip): LayerSource => {
      const k = rasterScale(layer)
      const progress = Math.round(layer.progress * 2000) / 2000
      return raster(clip.id, `${shapeKey(clip, layer)}|${progress}|${k}`, () => rasterizeShape(clip, layer.width, layer.height, progress, k))
    }

    for (let frame = 0; frame < totalFrames; frame++) {
      if (cancelled) throw new Error('Cancelled')
      const t = from + frame / request.fps
      const items: DrawItem[] = []
      for (const layer of evaluateFrame(project, t)) {
        const clip = layer.clip
        const source =
          clip.kind === 'video'
            ? await videoSource(layer, clip)
            : clip.kind === 'image'
              ? layer.asset
                ? await imageSource(layer.asset.path)
                : null
              : clip.kind === 'text'
                ? textSource(layer, clip)
                : clip.kind === 'shape'
                  ? shapeSource(layer, clip)
                  : ({ kind: 'backdrop' } as const)
        if (source) items.push({ layer, source, lut: layer.lutPath ? loadedLut(layer.lutPath) : undefined })
      }
      // Close decoders of clips that are no longer drawn.
      for (const [clipId, dec] of decoders) {
        const clip = project.clips[clipId]
        if (!clip || clip.kind !== 'video' || t >= visibleRange(project, clip)[1]) {
          await bridge.closeDecoder(dec.id)
          decoders.delete(clipId)
        }
      }
      compositor.render(items, project.settings.background, scale, frameFlash(project, t), offset)
      compositor.readPixels(pixels)
      await bridge.writeFrame(pixels)
      if (frame % 5 === 0) bridge.progress(0.03 + 0.95 * (frame / totalFrames), 'video')
    }

    for (const dec of decoders.values()) await bridge.closeDecoder(dec.id)
    bridge.progress(0.99, 'finalize')
    await bridge.finishEncoder()
    bridge.done({ path: request.outputPath, seconds: duration, encoder: session.encoder })
  } catch (err) {
    bridge.fail(err instanceof Error ? err.message : String(err))
  }
}
