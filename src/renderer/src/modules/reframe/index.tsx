import type { Draft } from 'immer'
import { ScanFace } from 'lucide-react'
import { useState } from 'react'
import type { Clip, VideoClip } from '@shared/project/schema'
import { editClip } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { sourceSpan } from '@renderer/core/project/speed'
import { mainTrack } from '@renderer/core/project/timeline'
import { useEditor } from '@renderer/core/store/editor'
import { JobFailure, runJobWithComponents } from '@renderer/core/store/jobs'
import { useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, Slider } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { planReframe } from './plan'

const strings = defineStrings({
  tr: {
    name: 'Otomatik çerçeveleme',
    desc: 'Klibi yeni en-boy oranına göre doldurur ve konuşan kişinin yüzünü kadrajda tutar.',
    section: 'Otomatik çerçeveleme',
    smooth: 'Yumuşaklık',
    run: 'Yüzü takip ederek çerçevele',
    runAll: 'Ana parçayı otomatik çerçevele',
    working: 'Yüzler aranıyor…',
    job: '{name}: yüzler aranıyor',
    noFaces: 'Klipte yüz bulunamadı; görüntü ortalandı.',
    done: 'Klip yüze göre çerçevelendi',
    doneAll: '{count} klip çerçevelendi',
    failed: 'Çerçevelenemedi',
    hint: 'Yatay videoyu dikey projeye koyduğunda kullan. Konum anahtar kareleri oluşturulur; sonradan düzenleyebilirsin.'
  },
  en: {
    name: 'Auto reframe',
    desc: 'Fills the frame for the project aspect ratio and keeps the speaker’s face in view.',
    section: 'Auto reframe',
    smooth: 'Smoothness',
    run: 'Reframe around the face',
    runAll: 'Auto reframe main track',
    working: 'Finding faces…',
    job: '{name}: finding faces',
    noFaces: 'No face found in the clip; the picture was centred.',
    done: 'Clip reframed around the face',
    doneAll: '{count} clips reframed',
    failed: 'Reframe failed',
    hint: 'Use it when a landscape video goes into a vertical project. Position keyframes are created and stay editable.'
  }
})
const tt = stringsT(strings)
const ID = 'reframe'
const SAMPLE_FPS = 3

/** Detects faces in the clip and rewrites its scale / position. Returns false without faces. */
async function reframe(clipId: string, smooth: number): Promise<boolean> {
  const project = useProject.getState().project!
  const clip = project.clips[clipId] as VideoClip
  const asset = project.assets[clip.assetId]
  if (!asset?.width || !asset.height) throw new Error('Unknown video size')
  const out = await runJobWithComponents(
    'video.detectFaces',
    { path: asset.path, start: clip.in, duration: sourceSpan(clip.speed, clip.duration), fps: SAMPLE_FPS, width: asset.width, height: asset.height, threshold: 0.75 },
    tt('job', { name: clip.name })
  )
  const plan = planReframe(clip, asset, project.settings, out.frames, SAMPLE_FPS, smooth)
  editClip(ID, clipId, tt('run'), (c) => {
    const tr = (c as Draft<VideoClip>).transform
    tr.scale = plan.scale
    tr.x = plan.x
    tr.y = plan.y
  })
  return out.frames.some((f) => f.faces.length)
}

const announce = (found: boolean) => (found ? toast.success(tt('done')) : toast.info(tt('noFaces')))

const report = (err: unknown) => {
  if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
}

function ReframeSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const [smooth, setSmooth] = useState(1.2)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    setBusy(true)
    try {
      announce(await reframe(clip.id, smooth))
    } catch (err) {
      report(err)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('section')} defaultOpen={false}>
      <Field label={t('smooth')}>
        <Slider min={0.2} max={4} step={0.1} value={smooth} onChange={setSmooth} label={t('smooth')} />
      </Field>
      <Button size="sm" icon={<ScanFace />} disabled={busy} onClick={run}>
        {busy ? t('working') : t('run')}
      </Button>
      <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{t('hint')}</p>
    </Section>
  )
}

async function reframeMain() {
  const p = useProject.getState().project!
  const main = mainTrack(p).id
  const ids = Object.values(p.clips)
    .filter((c): c is VideoClip => c.kind === 'video' && c.trackId === main)
    .map((c) => c.id)
  try {
    for (const id of ids) await reframe(id, 1.2)
    toast.success(tt('doneAll', { count: ids.length }))
  } catch (err) {
    report(err)
  }
}

const isVideo = (c: Clip) => c.kind === 'video'

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    {
      id: 'reframe.clip',
      title: () => tt('run'),
      enabled: () => {
        const p = useProject.getState().project
        const sel = useEditor.getState().selection
        return !!p && sel.length === 1 && p.clips[sel[0]]?.kind === 'video'
      },
      run: async () => {
        try {
          announce(await reframe(useEditor.getState().selection[0], 1.2))
        } catch (err) {
          report(err)
        }
      }
    },
    { id: 'reframe.main', title: () => tt('runAll'), enabled: () => !!useProject.getState().project, run: reframeMain }
  ],
  clipMenu: [{ command: 'reframe.clip', icon: ScanFace, order: 45 }],
  inspector: [{ id: 'reframe.section', tab: 'video', order: 22, when: isVideo, Component: ReframeSection }]
})
