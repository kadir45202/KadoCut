import type { Draft } from 'immer'
import { Crosshair, ScanFace } from 'lucide-react'
import { useState } from 'react'
import type { Clip, Project, Transform, VideoClip } from '@shared/project/schema'
import { defaultMask } from '@shared/project/defaults'
import { editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd, sourceTimeAt } from '@renderer/core/project/clip'
import { adjustmentClip } from '@renderer/core/project/factory'
import { evalAnimated } from '@renderer/core/project/keyframes'
import { localTimeForSourceOffset, sourceSpan } from '@renderer/core/project/speed'
import { addTrack, isRangeFree } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { JobFailure, runJobWithComponents } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { expandCompounds } from '@renderer/engine/expand'
import { evaluateFrame, hitTest, layerFor, pixelSource, type VisualClip } from '@renderer/engine/scene'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, Slider } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { linkFaces, samplesToKeys } from './plan'

const strings = defineStrings({
  tr: {
    name: 'Hareket takibi',
    desc: 'Yazı, çıkartma veya bulanıklığı videodaki hareketli bir nesneye bağlar; yüzleri otomatik bulanıklaştırır.',
    section: 'Hareket takibi',
    area: 'Takip alanı',
    track: 'Altındaki videoda takip et',
    working: 'Takip ediliyor…',
    job: '{name}: hareket takibi',
    noVideo: 'Bu klibin altında video yok. Klibi takip edilecek nesnenin üstüne koy.',
    done: 'Hareket takip edildi',
    partly: 'Takip edildi; nesne bazı yerlerde kayboldu, anahtar kareleri kontrol et.',
    failed: 'Takip yapılamadı',
    hint: 'Önce klibi takip edilecek nesnenin üstüne yerleştir, oynatma çizgisini takibin başlayacağı kareye getir.',
    blurFaces: 'Yüzleri bulanıklaştır',
    blurJob: '{name}: yüzler aranıyor',
    blurDone: '{count} yüz bulanıklaştırıldı',
    noFaces: 'Videoda yüz bulunamadı',
    faceBlur: 'Yüz bulanıklığı'
  },
  en: {
    name: 'Motion tracking',
    desc: 'Pins text, stickers or a blur to a moving object in the video; blurs faces automatically.',
    section: 'Motion tracking',
    area: 'Track area',
    track: 'Track the video below',
    working: 'Tracking…',
    job: '{name}: motion tracking',
    noVideo: 'There is no video under this clip. Place the clip over the object to follow.',
    done: 'Motion tracked',
    partly: 'Tracked; the object was lost in places, check the keyframes.',
    failed: 'Tracking failed',
    hint: 'Place the clip over the object first and move the playhead to the frame where tracking starts.',
    blurFaces: 'Blur faces',
    blurJob: '{name}: finding faces',
    blurDone: '{count} faces blurred',
    noFaces: 'No faces found in the video',
    faceBlur: 'Face blur'
  }
})
const tt = stringsT(strings)
const ID = 'tracking'

type Movable = Extract<Clip, { transform: Transform }>
type Matrix = [number, number, number, number, number, number]
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

const report = (err: unknown) => {
  if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
}

/** Topmost top-level video drawn below `clipId` that covers canvas point (x, y) at time t. */
function videoBelow(p: Project, clipId: string, t: number, x: number, y: number): VideoClip | null {
  const layers = evaluateFrame(expandCompounds(p), t)
  const index = layers.findIndex((l) => l.clip.id === clipId)
  for (let i = (index < 0 ? layers.length : index) - 1; i >= 0; i--) {
    const l = layers[i]
    if (l.clip.kind === 'video' && !l.clip.parent && hitTest(l, x, y)) return l.clip
  }
  return null
}

/** Timeline time of a source time in a video clip. */
const timelineAt = (v: VideoClip, src: number) => v.start + localTimeForSourceOffset(v.speed, v.duration, Math.max(0, src - v.in))

/** Follows the object under the clip and writes position keyframes. */
async function trackClip(clipId: string, area: number): Promise<boolean> {
  const p = useProject.getState().project!
  const target = p.clips[clipId] as Movable
  const t0 = Math.min(Math.max(useEditor.getState().playhead, target.start), clipEnd(target) - 1 / p.settings.fps)
  const own = layerFor(p, target as VisualClip, t0)
  if (!own) throw new Error('Clip is not visible')
  const [cx, cy] = apply(own.matrix, own.width / 2, own.height / 2)
  const video = videoBelow(p, clipId, t0, cx, cy)
  if (!video) {
    toast.info(tt('noVideo'))
    return true
  }
  const vLayer = layerFor(p, video, t0)!
  const [a, b, c, d, e, f] = vLayer.matrix
  const det = a * d - b * c
  const mx = (d * (cx - e) - c * (cy - f)) / det
  const my = (-b * (cx - e) + a * (cy - f)) / det
  const asset = pixelSource(p, video).asset ?? p.assets[video.assetId]
  const s0 = sourceTimeAt(video, t0)
  const s1 = sourceTimeAt(video, Math.min(clipEnd(target), clipEnd(video)))
  const out = await runJobWithComponents(
    'video.track',
    {
      path: asset.path,
      start: s0,
      duration: Math.max(1 / p.settings.fps, s1 - s0),
      fps: Math.min(30, asset.fps || 30),
      width: vLayer.width,
      height: vLayer.height,
      x: mx / vLayer.width,
      y: my / vLayer.height,
      size: area
    },
    tt('job', { name: target.name })
  )
  if (!out.points.length) return false
  // Canvas position of each tracked point (follows the video's own transform too).
  const now = useProject.getState().project!
  const positions = out.points.map((pt) => {
    const t = timelineAt(video, pt.t)
    const layer = layerFor(now, video, t)!
    return { t, pos: apply(layer.matrix, pt.x * layer.width, pt.y * layer.height) }
  })
  const [px0, py0] = positions[0].pos
  const { width: cw, height: ch } = now.settings
  const local0 = t0 - target.start
  const x0 = evalAnimated(target.transform.x, local0)
  const y0 = evalAnimated(target.transform.y, local0)
  const step = 1 / 15
  const xs = samplesToKeys(positions.map((q) => ({ t: q.t - target.start, v: x0 + (q.pos[0] - px0) / cw })), step)
  const ys = samplesToKeys(positions.map((q) => ({ t: q.t - target.start, v: y0 + (q.pos[1] - py0) / ch })), step)
  editClip(ID, clipId, tt('track'), (cl) => {
    const tr = (cl as Draft<Movable>).transform
    tr.x = { value: xs[0]?.v ?? x0, keys: xs }
    tr.y = { value: ys[0]?.v ?? y0, keys: ys }
  })
  return out.points.every((pt) => pt.confident)
}

/** A free video track above `trackId` for [start, end), created on top if needed. */
function trackAbove(draft: Project, trackId: string, start: number, end: number) {
  const index = draft.tracks.findIndex((t) => t.id === trackId)
  const free = draft.tracks.slice(index + 1).find((t) => t.kind === 'video' && !t.locked && isRangeFree(draft, t.id, start, end))
  return free ?? addTrack(draft, 'video')
}

/** Finds faces in a video clip and adds a tracked blur layer for each one. */
async function blurFaces(clipId: string): Promise<number> {
  const p = useProject.getState().project!
  const video = p.clips[clipId] as VideoClip
  const asset = p.assets[video.assetId]
  const fps = 6
  const out = await runJobWithComponents(
    'video.detectFaces',
    { path: asset.path, start: video.in, duration: sourceSpan(video.speed, video.duration), fps, width: asset.width, height: asset.height, threshold: 0.7 },
    tt('blurJob', { name: video.name })
  )
  const tracks = linkFaces(out.frames, 0.6).filter((tr) => tr.points.length >= 3)
  if (!tracks.length) return 0
  const now = useProject.getState().project!
  const { width: cw, height: ch } = now.settings
  const ids: string[] = []
  projectActions.apply(
    tt('blurFaces'),
    (dd) => {
      const draft = dd as Project
      for (const track of tracks) {
        const samples = track.points.map((pt) => {
          const t = timelineAt(video, pt.t)
          const layer = layerFor(now, video, t)!
          const [x, y] = apply(layer.matrix, (pt.box.x + pt.box.w / 2) * layer.width, (pt.box.y + pt.box.h / 2) * layer.height)
          const scale = Math.hypot(layer.matrix[0], layer.matrix[1])
          return { t, x, y, w: pt.box.w * layer.width * scale, h: pt.box.h * layer.height * scale }
        })
        const start = Math.max(video.start, samples[0].t - 0.15)
        const end = Math.min(clipEnd(video), samples[samples.length - 1].t + 1 / fps + 0.15)
        if (end - start < 0.1) continue
        const clip = adjustmentClip('', start)
        clip.name = tt('faceBlur')
        clip.duration = end - start
        clip.effect = { type: 'blur', amount: 0.8 }
        clip.mask = {
          ...defaultMask(),
          type: 'circle',
          width: (Math.max(...samples.map((s) => s.w)) * 1.5) / cw,
          height: (Math.max(...samples.map((s) => s.h)) * 1.6) / ch,
          feather: 0.25
        }
        const xs = samplesToKeys(samples.map((s) => ({ t: s.t - start, v: (s.x - cw / 2) / cw })), 1 / fps)
        const ys = samplesToKeys(samples.map((s) => ({ t: s.t - start, v: (s.y - ch / 2) / ch })), 1 / fps)
        clip.transform.x = { value: xs[0].v, keys: xs.length > 1 ? xs : [] }
        clip.transform.y = { value: ys[0].v, keys: ys.length > 1 ? ys : [] }
        clip.trackId = trackAbove(draft, video.trackId, start, end).id
        draft.clips[clip.id] = clip
        ids.push(clip.id)
      }
    },
    ID
  )
  if (ids.length) editorActions.select(ids)
  return ids.length
}

function TrackingSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const [area, setArea] = useState(0.08)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const steady = await trackClip(clip.id, area)
      if (steady) toast.success(t('done'))
      else toast.info(t('partly'))
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('section')} defaultOpen={false}>
      <Field label={t('area')}>
        <Slider min={0.03} max={0.25} step={0.01} value={area} onChange={setArea} label={t('area')} />
      </Field>
      <Button size="sm" icon={<Crosshair />} disabled={busy} onClick={run}>
        {busy ? t('working') : t('track')}
      </Button>
      <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{t('hint')}</p>
    </Section>
  )
}

function FaceBlurSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      const count = await blurFaces(clip.id)
      if (count) toast.success(t('blurDone', { count }))
      else toast.info(t('noFaces'))
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" icon={<ScanFace />} disabled={busy} onClick={run}>
      {busy ? t('working') : t('blurFaces')}
    </Button>
  )
}

const trackable = (c: Clip) => c.kind === 'text' || c.kind === 'shape' || c.kind === 'image' || c.kind === 'adjustment'

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [
    { id: 'tracking.video', tab: 'video', order: 50, when: (c) => trackable(c) && c.kind !== 'text', Component: TrackingSection },
    { id: 'tracking.text', tab: 'text', order: 30, when: (c) => c.kind === 'text', Component: TrackingSection },
    { id: 'tracking.faces', tab: 'video', order: 23, when: (c) => c.kind === 'video', Component: FaceBlurSection }
  ]
})
