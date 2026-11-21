import { useEffect, useState } from 'react'
import { Images } from 'lucide-react'
import { create } from 'zustand'
import type { Asset, ImageClip, Project } from '@shared/project/schema'
import { defaultTransform } from '@shared/project/defaults'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd, snapToFrame } from '@renderer/core/project/clip'
import { clipFromAsset } from '@renderer/core/project/factory'
import { clipsOnTrack, findOrCreateFreeTrack, mainTrack } from '@renderer/core/project/timeline'
import { editorActions } from '@renderer/core/store/editor'
import { runJob } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { loadPcm } from '@renderer/engine/audio'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { mediaUrl } from '@renderer/lib/api'
import { Button, Segmented, Select, Switch } from '@renderer/ui/controls'
import { Field } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import { detectBeats } from '../beats/detect'
import { coverScale, kenBurns, slideDurations, slideTransition } from './plan'
import s from './slideshow.module.css'

const strings = defineStrings({
  tr: {
    name: 'Slayt gösterisi',
    desc: 'Fotoğraflardan hareketli (Ken Burns) slayt gösterisi oluşturur; istenirse müziğin ritmine göre keser.',
    open: 'Fotoğraflardan slayt gösterisi',
    title: 'Fotoğraflardan slayt gösterisi',
    photos: 'Fotoğraflar ({count} seçili)',
    none: 'Projede fotoğraf yok. Önce görselleri içe aktar.',
    perPhoto: 'Fotoğraf başına',
    music: 'Müzik',
    noMusic: 'Müzik yok',
    onBeat: 'Ritme göre kes',
    motion: 'Yavaş yakınlaşma ve kaydırma',
    fill: 'Ekranı doldur (kırp)',
    transition: 'Geçiş',
    'tr.none': 'Yok',
    'tr.dissolve': 'Çapraz geçiş',
    'tr.flash': 'Flaş',
    'tr.mixed': 'Karışık',
    create: 'Oluştur',
    cancel: 'Vazgeç',
    working: 'Müziğin ritmi bulunuyor…',
    done: '{count} fotoğraflık slayt gösterisi eklendi',
    clipName: 'Slayt'
  },
  en: {
    name: 'Slideshow',
    desc: 'Builds a moving (Ken Burns) slideshow from photos, optionally cut to the music’s beat.',
    open: 'Slideshow from photos',
    title: 'Slideshow from photos',
    photos: 'Photos ({count} selected)',
    none: 'No photos in the project. Import some images first.',
    perPhoto: 'Per photo',
    music: 'Music',
    noMusic: 'No music',
    onBeat: 'Cut on the beat',
    motion: 'Slow zoom and pan',
    fill: 'Fill the frame (crop)',
    transition: 'Transition',
    'tr.none': 'None',
    'tr.dissolve': 'Cross dissolve',
    'tr.flash': 'Flash',
    'tr.mixed': 'Mixed',
    create: 'Create',
    cancel: 'Cancel',
    working: 'Finding the beat…',
    done: 'Slideshow of {count} photos added',
    clipName: 'Slide'
  }
})
const tt = stringsT(strings)
const ID = 'slideshow'

type TransitionMode = 'none' | 'dissolve' | 'flash' | 'mixed'

interface Options {
  photos: string[]
  perPhoto: number
  musicId: string
  onBeat: boolean
  motion: boolean
  fill: boolean
  transition: TransitionMode
}

const useSlideshow = create<{ open: boolean }>(() => ({ open: false }))

const byName = (a: Asset, b: Asset) => a.name.localeCompare(b.name, undefined, { numeric: true })

/** Beats of a music file (detected once and stored on the asset). */
async function musicBeats(asset: Asset): Promise<number[]> {
  if (asset.beats.length) return asset.beats
  const audio = await runJob('media.audio', { path: asset.path }, tt('working'))
  const buffer = await loadPcm(audio.pcmPath)
  const l = buffer.getChannelData(0)
  const r = buffer.getChannelData(1)
  const mono = new Float32Array(l.length)
  for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2
  const beats = detectBeats(mono, buffer.sampleRate).beats.map((b) => Math.round(b * 1000) / 1000)
  projectActions.apply(tt('onBeat'), (d) => void (d.assets[asset.id] && (d.assets[asset.id].beats = beats)), ID)
  return beats
}

export async function buildSlideshow(opts: Options): Promise<number> {
  const project = useProject.getState().project!
  const photos = opts.photos.map((id) => project.assets[id]).filter((a): a is Asset => a?.kind === 'image')
  if (!photos.length) return 0
  const music = opts.musicId ? project.assets[opts.musicId] : undefined
  const beats = music && opts.onBeat ? await musicBeats(music) : []
  const durations = slideDurations(photos.length, opts.perPhoto, beats)
  const ids: string[] = []
  projectActions.apply(
    tt('open'),
    (d) => {
      const p = d as Project
      const { width: cw, height: ch, fps } = p.settings
      const main = mainTrack(p)
      const start = clipsOnTrack(p, main.id).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
      // Cut times on the frame grid so the photos stay back to back.
      let elapsed = 0
      photos.forEach((asset, i) => {
        const from = snapToFrame(start + elapsed, fps)
        elapsed += durations[i]
        const to = Math.max(from + 1 / fps, snapToFrame(start + elapsed, fps))
        const clip = clipFromAsset(asset, main.id, from) as ImageClip
        clip.duration = to - from
        clip.name = `${tt('clipName')} ${i + 1} · ${asset.name}`
        const base = opts.fill ? coverScale(asset.width, asset.height, cw, ch) : 1
        clip.transform = opts.motion ? kenBurns(i, clip.duration, base) : { ...defaultTransform(), scale: { value: base, keys: [] } }
        const type = slideTransition(i, opts.transition)
        clip.transition = type ? { type, duration: Math.min(0.6, clip.duration / 3) } : null
        p.clips[clip.id] = clip
        ids.push(clip.id)
      })
      if (music) {
        const end = snapToFrame(start + elapsed, fps)
        const clip = clipFromAsset(music, '', start)
        clip.duration = Math.min(clip.duration, end - start)
        if ('audio' in clip) clip.audio.fadeOut = Math.min(1.5, clip.duration / 3)
        clip.trackId = findOrCreateFreeTrack(p, 'audio', start, start + clip.duration).id
        p.clips[clip.id] = clip
      }
    },
    ID
  )
  if (ids.length) editorActions.select(ids)
  return ids.length
}

function SlideshowDialog() {
  const t = useStrings(strings)
  const open = useSlideshow((st) => st.open)
  const assets = useProject((st) => st.project?.assets ?? {})
  const images = Object.values(assets).filter((a) => a.kind === 'image' && !a.hidden).sort(byName)
  const songs = Object.values(assets).filter((a) => a.kind === 'audio' && !a.hidden)
  const [opts, setOpts] = useState<Options>({ photos: [], perPhoto: 3, musicId: '', onBeat: true, motion: true, fill: true, transition: 'dissolve' })
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Options>) => setOpts((o) => ({ ...o, ...patch }))

  useEffect(() => {
    if (open) set({ photos: images.map((a) => a.id), musicId: '' })
  }, [open])

  const close = () => useSlideshow.setState({ open: false })
  const run = async () => {
    setBusy(true)
    try {
      const count = await buildSlideshow(opts)
      if (count) toast.success(t('done', { count }))
      close()
    } catch (err) {
      toast.error(t('title'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !busy && useSlideshow.setState({ open: o })}
      title={t('title')}
      wide
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || opts.photos.length === 0}>
            {busy && opts.onBeat && opts.musicId ? t('working') : t('create')}
          </Button>
        </>
      }
    >
      {images.length === 0 ? (
        <p className={s.hint}>{t('none')}</p>
      ) : (
        <div className={s.form}>
          <span className={s.label}>{t('photos', { count: opts.photos.length })}</span>
          <div className={s.photos}>
            {images.map((a) => {
              const on = opts.photos.includes(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  className={s.photo}
                  data-on={on}
                  aria-pressed={on}
                  title={a.name}
                  onClick={() => set({ photos: on ? opts.photos.filter((id) => id !== a.id) : images.map((x) => x.id).filter((id) => id === a.id || opts.photos.includes(id)) })}
                >
                  <img src={mediaUrl(a.path)} alt="" loading="lazy" draggable={false} />
                </button>
              )
            })}
          </div>
          <Field label={t('perPhoto')}>
            <Segmented<string> value={String(opts.perPhoto)} onChange={(v) => set({ perPhoto: Number(v) })} options={['2', '3', '4', '5'].map((v) => ({ value: v, label: `${v} sn` }))} />
          </Field>
          <Field label={t('music')}>
            <Select<string>
              value={opts.musicId || 'none'}
              label={t('music')}
              onChange={(v) => set({ musicId: v === 'none' ? '' : v })}
              options={[{ value: 'none', label: t('noMusic') }, ...songs.map((a) => ({ value: a.id, label: a.name }))]}
            />
          </Field>
          {opts.musicId && (
            <Field label={t('onBeat')}>
              <Switch checked={opts.onBeat} label={t('onBeat')} onChange={(onBeat) => set({ onBeat })} />
            </Field>
          )}
          <Field label={t('motion')}>
            <Switch checked={opts.motion} label={t('motion')} onChange={(motion) => set({ motion })} />
          </Field>
          <Field label={t('fill')}>
            <Switch checked={opts.fill} label={t('fill')} onChange={(fill) => set({ fill })} />
          </Field>
          <Field label={t('transition')}>
            <Segmented<TransitionMode>
              value={opts.transition}
              onChange={(transition) => set({ transition })}
              options={(['none', 'dissolve', 'flash', 'mixed'] as const).map((v) => ({ value: v, label: t(`tr.${v}`) }))}
            />
          </Field>
        </div>
      )}
    </Dialog>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    {
      id: 'slideshow.open',
      title: () => tt('open'),
      enabled: () => !!useProject.getState().project,
      run: () => useSlideshow.setState({ open: true })
    }
  ],
  assetMenu: [{ id: 'slideshow', title: () => tt('open'), icon: Images, order: 30, when: (a) => a.kind === 'image', run: () => useSlideshow.setState({ open: true }) }],
  dialogs: [{ id: 'slideshow', Component: SlideshowDialog }]
})
