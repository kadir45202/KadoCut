import { Speech } from 'lucide-react'
import { useState } from 'react'
import type { TextClip } from '@shared/project/schema'
import { addAsset, addAssetToTimeline, probeAsset } from '@renderer/core/media/import'
import { defineModule } from '@renderer/core/modules/types'
import { useEditor } from '@renderer/core/store/editor'
import { JobFailure, runJobWithComponents, useJobs } from '@renderer/core/store/jobs'
import { useProject } from '@renderer/core/store/project'
import { useSettings } from '@renderer/core/store/settings'
import { defineStrings, stringsT, useLanguage, useStrings } from '@renderer/i18n'
import { Button, Segmented, TextArea } from '@renderer/ui/controls'
import { Field, Progress } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import s from './tts.module.css'

const strings = defineStrings({
  tr: {
    name: 'Metin okutma',
    desc: 'Yazdığın metni seslendirir (ElevenLabs anahtarı varsa bulut, yoksa yerel Piper sesi).',
    panel: 'Seslendir',
    placeholder: 'Seslendirilecek metni yaz…',
    language: 'Dil',
    speak: 'Seslendir ve ekle',
    working: 'Seslendiriliyor…',
    job: 'Metin seslendiriliyor',
    failed: 'Seslendirme yapılamadı',
    fallback: 'Bulut servisi yanıt vermedi; yerel ses kullanıldı.',
    viaCloud: 'ElevenLabs ile (bulut) seslendirilecek.',
    viaLocal: 'Yerel Piper sesiyle seslendirilecek. Daha doğal ses için Ayarlar’dan ElevenLabs anahtarı ekleyebilirsin.',
    speakClip: 'Metni seslendir',
    clipName: 'Seslendirme: {text}'
  },
  en: {
    name: 'Text to speech',
    desc: 'Voices your text (ElevenLabs in the cloud with a key, otherwise a local Piper voice).',
    panel: 'Voice',
    placeholder: 'Type the text to voice…',
    language: 'Language',
    speak: 'Voice and add',
    working: 'Generating voice…',
    job: 'Generating voice-over',
    failed: 'Voice-over failed',
    fallback: 'The cloud service did not respond; the local voice was used.',
    viaCloud: 'Will be voiced with ElevenLabs (cloud).',
    viaLocal: 'Will be voiced with a local Piper voice. Add an ElevenLabs key in Settings for a more natural voice.',
    speakClip: 'Voice this text',
    clipName: 'Voice-over: {text}'
  }
})
const tt = stringsT(strings)
const ID = 'tts'

async function speak(text: string, language: 'tr' | 'en', at: number, onStart?: (id: string) => void) {
  const project = useProject.getState().project!
  const out = await runJobWithComponents('tts.synthesize', { projectId: project.id, text, language }, tt('job'), onStart)
  const asset = await probeAsset(out.path, {
    name: tt('clipName', { text: text.slice(0, 32) }),
    hidden: false,
    derived: { kind: 'tts', sourceAssetId: '', params: { provider: out.provider, language } },
    beats: [],
    transcript: null
  })
  if (addAsset(asset, tt('speak'), ID)) addAssetToTimeline(asset, { at })
  if (out.warning) toast.info(tt('fallback'), out.warning)
}

function TtsPanel() {
  const t = useStrings(strings)
  const appLang = useLanguage((st) => st.lang)
  const cloud = useSettings((st) => st.secrets.elevenlabs)
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<'tr' | 'en'>(appLang)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJobs((st) => (jobId ? st.jobs[jobId] : undefined))
  const [busy, setBusy] = useState(false)

  const run = async () => {
    setBusy(true)
    try {
      await speak(text.trim(), language, useEditor.getState().playhead, setJobId)
    } catch (err) {
      if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(t('failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setJobId(null)
    }
  }

  return (
    <div className={s.panel}>
      <TextArea value={text} placeholder={t('placeholder')} rows={6} onChange={(e) => setText(e.target.value)} />
      <Field label={t('language')}>
        <Segmented<'tr' | 'en'>
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'tr', label: 'Türkçe' },
            { value: 'en', label: 'English' }
          ]}
        />
      </Field>
      <Button variant="primary" icon={<Speech />} disabled={busy || !text.trim()} onClick={run}>
        {busy ? t('working') : t('speak')}
      </Button>
      {busy && <Progress value={job && job.progress > 0 ? job.progress : null} />}
      <p className={s.hint}>{cloud ? t('viaCloud') : t('viaLocal')}</p>
    </div>
  )
}

function selectedText(): TextClip | undefined {
  const p = useProject.getState().project
  const sel = useEditor.getState().selection
  const c = p && sel.length === 1 ? p.clips[sel[0]] : undefined
  return c?.kind === 'text' && c.text.trim() ? c : undefined
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'tts', title: () => tt('panel'), icon: Speech, order: 40, Component: TtsPanel }],
  commands: [
    {
      id: 'tts.speakClip',
      title: () => tt('speakClip'),
      enabled: () => !!selectedText(),
      run: async () => {
        const clip = selectedText()
        if (!clip) return
        try {
          await speak(clip.text, useLanguage.getState().lang, clip.start)
        } catch (err) {
          if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
        }
      }
    }
  ],
  clipMenu: [{ command: 'tts.speakClip', icon: Speech, order: 50, separatorBefore: true }]
})
