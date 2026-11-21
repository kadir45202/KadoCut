import { AudioWaveform, Drum } from 'lucide-react'
import { useState } from 'react'
import type { AudioClip, Clip, Project, VideoClip } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { beatPoints } from '@renderer/core/project/timeline'
import { useEditor } from '@renderer/core/store/editor'
import { runJob } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { loadPcm } from '@renderer/engine/audio'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { Button, Segmented } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { detectBeats } from './detect'
import { alignToBeats } from './sync'

const strings = defineStrings({
  tr: {
    name: 'Vuruşa kesme',
    desc: 'Müzikteki vuruşları bulur, timeline’da işaretler ve kesimleri vuruşlara hizalar.',
    section: 'Vuruşlar',
    detect: 'Vuruşları algıla',
    working: 'Müzik analiz ediliyor…',
    found: '{count} vuruş bulundu · {bpm} BPM',
    none: 'Vuruş bulunamadı',
    failed: 'Vuruşlar algılanamadı',
    every: 'Kesim sıklığı',
    each: 'Her vuruş',
    align: 'Ana parçayı vuruşlara hizala',
    aligned: '{count} kesim vuruşa hizalandı',
    noBeats: 'Önce bir müzik klibinde vuruşları algıla.',
    hint: 'Vuruşlar timeline’da işaretlenir; klipleri sürüklerken yakalama noktası olur.'
  },
  en: {
    name: 'Beat sync',
    desc: 'Finds the beats in music, marks them on the timeline and lines cuts up with them.',
    section: 'Beats',
    detect: 'Detect beats',
    working: 'Analysing music…',
    found: '{count} beats found · {bpm} BPM',
    none: 'No beats found',
    failed: 'Beat detection failed',
    every: 'Cut every',
    each: 'Beat',
    align: 'Align main track to beats',
    aligned: '{count} cuts moved onto beats',
    noBeats: 'Detect the beats of a music clip first.',
    hint: 'Beats are marked on the timeline and become snap points while dragging.'
  }
})
const tt = stringsT(strings)
const ID = 'beats'

type Sound = AudioClip | VideoClip
const isSound = (c: Clip, p: Project): c is Sound => (c.kind === 'audio' || c.kind === 'video') && !!p.assets[c.assetId]?.hasAudio

/** Decodes the clip's whole file, finds beats and stores them on the asset. */
async function detect(clip: Sound): Promise<{ count: number; bpm: number }> {
  const asset = useProject.getState().project!.assets[clip.assetId]
  const audio = await runJob('media.audio', { path: asset.path }, tt('working'))
  const buffer = await loadPcm(audio.pcmPath)
  const l = buffer.getChannelData(0)
  const r = buffer.getChannelData(1)
  const mono = new Float32Array(l.length)
  for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2
  const { beats, bpm } = detectBeats(mono, buffer.sampleRate)
  const rounded = beats.map((b) => Math.round(b * 1000) / 1000)
  projectActions.apply(
    tt('detect'),
    (d) => {
      const a = d.assets[asset.id]
      if (a) a.beats = rounded
    },
    ID
  )
  return { count: beats.length, bpm: Math.round(bpm) }
}

function align(every: number) {
  const beats = beatPoints(useProject.getState().project!)
  if (!beats.length) {
    toast.info(tt('noBeats'))
    return
  }
  let count = 0
  projectActions.apply(tt('align'), (d) => void (count = alignToBeats(d as Project, beats, every)), ID)
  toast.success(tt('aligned', { count }))
}

function BeatsSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const beats = useProject((st) => ('assetId' in clip ? st.project!.assets[clip.assetId]?.beats.length : 0) ?? 0)
  const [busy, setBusy] = useState(false)
  const [every, setEvery] = useState<'1' | '2' | '4'>('1')
  const run = async () => {
    setBusy(true)
    try {
      const { count, bpm } = await detect(clip as Sound)
      if (count) toast.success(t('found', { count, bpm }))
      else toast.info(t('none'))
    } catch (err) {
      toast.error(t('failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title={t('section')} defaultOpen={clip.kind === 'audio'}>
      <Button size="sm" icon={<AudioWaveform />} disabled={busy} onClick={run}>
        {busy ? t('working') : t('detect')}
      </Button>
      {beats > 0 && (
        <>
          <Field label={t('every')}>
            <Segmented<'1' | '2' | '4'>
              value={every}
              onChange={setEvery}
              options={[
                { value: '1', label: t('each') },
                { value: '2', label: '2' },
                { value: '4', label: '4' }
              ]}
            />
          </Field>
          <Button size="sm" icon={<Drum />} onClick={() => align(Number(every))}>
            {t('align')}
          </Button>
        </>
      )}
      <p style={{ margin: 0, color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{t('hint')}</p>
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    {
      id: 'beats.detect',
      title: () => tt('detect'),
      enabled: () => {
        const p = useProject.getState().project
        const sel = useEditor.getState().selection
        const c = p && sel.length === 1 ? p.clips[sel[0]] : undefined
        return !!c && !!p && isSound(c, p)
      },
      run: async () => {
        const p = useProject.getState().project!
        const { count, bpm } = await detect(p.clips[useEditor.getState().selection[0]] as Sound)
        if (count) toast.success(tt('found', { count, bpm }))
        else toast.info(tt('none'))
      }
    },
    { id: 'beats.align', title: () => tt('align'), enabled: () => !!useProject.getState().project, run: () => align(1) }
  ],
  clipMenu: [{ command: 'beats.detect', icon: AudioWaveform, order: 55 }],
  inspector: [{ id: 'beats.section', tab: 'audio', order: 40, when: isSound, Component: BeatsSection }]
})
