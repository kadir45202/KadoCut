import { useEffect, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { create } from 'zustand'
import { defineModule } from '@renderer/core/modules/types'
import { addAssetToTimeline, importFiles } from '@renderer/core/media/import'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useEditor } from '@renderer/core/store/editor'
import { getPreview } from '@renderer/engine/preview'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { Button, Select, Switch } from '@renderer/ui/controls'
import { toast } from '@renderer/ui/toast'
import s from './voiceover.module.css'

const strings = defineStrings({
  tr: {
    name: 'Seslendirme kaydı',
    desc: 'Mikrofondan, video oynarken seslendirme kaydeder ve oynatma çizgisine yerleştirir.',
    panel: 'Kayıt',
    mic: 'Mikrofon',
    defaultMic: 'Varsayılan mikrofon',
    playVideo: 'Kayıt sırasında videoyu oynat',
    muteProject: 'Kayıtta proje sesini kapat',
    muteHint: 'Hoparlör kullanıyorsan açık bırak; kulaklıkla kapatabilirsin.',
    enhance: 'Gürültü ve yankı bastırma',
    start: 'Kaydı başlat',
    stop: 'Kaydı bitir',
    cancel: 'Vazgeç',
    countdown: 'Kayıt başlıyor…',
    recording: 'Kaydediliyor',
    saving: 'Kayıt kaydediliyor…',
    added: 'Seslendirme eklendi',
    failed: 'Kayıt yapılamadı',
    noMic: 'Mikrofona erişilemedi. Windows Ayarlar → Gizlilik → Mikrofon bölümünden masaüstü uygulamalarına izin ver.',
    hint: 'Kayıt oynatma çizgisinden başlar. Bitirince ses, zaman çizelgesinde kaydın başladığı yere eklenir.',
    clip: 'Seslendirme'
  },
  en: {
    name: 'Voiceover recording',
    desc: 'Records a voiceover from the microphone while the video plays and places it at the playhead.',
    panel: 'Record',
    mic: 'Microphone',
    defaultMic: 'Default microphone',
    playVideo: 'Play the video while recording',
    muteProject: 'Mute project audio while recording',
    muteHint: 'Keep this on with speakers; with headphones you can turn it off.',
    enhance: 'Noise and echo suppression',
    start: 'Start recording',
    stop: 'Stop recording',
    cancel: 'Cancel',
    countdown: 'Recording starts…',
    recording: 'Recording',
    saving: 'Saving the recording…',
    added: 'Voiceover added',
    failed: 'Recording failed',
    noMic: 'The microphone is not available. Allow desktop apps in Windows Settings → Privacy → Microphone.',
    hint: 'Recording starts at the playhead. When you stop, the audio is placed on the timeline where the recording began.',
    clip: 'Voiceover'
  }
})
const tt = stringsT(strings)
const ID = 'voiceover'

type Phase = 'idle' | 'countdown' | 'recording' | 'saving'

interface RecState {
  phase: Phase
  count: number
  startedAt: number
  /** Timeline time where the recording began. */
  at: number
  level: number
  deviceId: string
  playVideo: boolean
  muteProject: boolean
  enhance: boolean
}

const useRec = create<RecState>(() => ({
  phase: 'idle',
  count: 0,
  startedAt: 0,
  at: 0,
  level: 0,
  deviceId: '',
  playVideo: true,
  muteProject: true,
  enhance: true
}))

// Live recording objects (kept outside React so switching panels does not stop a take).
let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let timer = 0
let meterRaf = 0
let audioCtx: AudioContext | null = null

function release() {
  window.clearInterval(timer)
  cancelAnimationFrame(meterRaf)
  stream?.getTracks().forEach((tr) => tr.stop())
  stream = null
  recorder = null
  void audioCtx?.close()
  audioCtx = null
  getPreview()?.setOutputMuted(false)
}

async function start() {
  const st = useRec.getState()
  if (st.phase !== 'idle' || !useProject.getState().project) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: st.deviceId ? { exact: st.deviceId } : undefined,
        echoCancellation: st.enhance,
        noiseSuppression: st.enhance,
        autoGainControl: st.enhance
      }
    })
  } catch (err) {
    log.warn('voiceover', `getUserMedia failed: ${String(err)}`)
    toast.error(tt('failed'), tt('noMic'))
    return
  }
  // Input level for the panel's meter.
  audioCtx = new AudioContext()
  const analyser = audioCtx.createAnalyser()
  analyser.fftSize = 1024
  audioCtx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  const meter = () => {
    analyser.getFloatTimeDomainData(buf)
    let peak = 0
    for (const v of buf) peak = Math.max(peak, Math.abs(v))
    useRec.setState({ level: peak })
    meterRaf = requestAnimationFrame(meter)
  }
  meter()

  useRec.setState({ phase: 'countdown', count: 3 })
  timer = window.setInterval(() => {
    const count = useRec.getState().count - 1
    if (count > 0) return useRec.setState({ count })
    window.clearInterval(timer)
    begin()
  }, 1000)
}

function begin() {
  if (!stream) return
  const st = useRec.getState()
  chunks = []
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 192_000 })
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start(500)
  const at = useEditor.getState().playhead
  useRec.setState({ phase: 'recording', startedAt: Date.now(), at })
  const preview = getPreview()
  preview?.setOutputMuted(st.muteProject)
  if (st.playVideo) void preview?.play()
  timer = window.setInterval(() => useRec.setState({ count: Math.floor((Date.now() - useRec.getState().startedAt) / 1000) }), 250)
}

async function stop() {
  const st = useRec.getState()
  if (st.phase === 'countdown') {
    release()
    return useRec.setState({ phase: 'idle' })
  }
  if (st.phase !== 'recording' || !recorder) return
  const rec = recorder
  const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()))
  rec.stop()
  getPreview()?.pause()
  useRec.setState({ phase: 'saving' })
  await done
  release()
  try {
    const project = useProject.getState().project!
    const data = new Uint8Array(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer())
    chunks = []
    const path = await api.media.saveRecording(project.id, data)
    const [asset] = await importFiles([path])
    if (asset) {
      const n = Object.values(useProject.getState().project!.assets).filter((a) => a.name.startsWith('voiceover-')).length
      const clipId = addAssetToTimeline(asset, { at: st.at })
      if (clipId) projectActions.apply(tt('clip'), (d) => void (d.clips[clipId] && (d.clips[clipId].name = `${tt('clip')} ${n}`)), ID)
      toast.success(tt('added'))
    }
  } catch (err) {
    log.error('voiceover', 'saving failed', err)
    toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
  } finally {
    useRec.setState({ phase: 'idle', level: 0 })
  }
}

function VoiceoverPanel() {
  const t = useStrings(strings)
  const st = useRec()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const load = () => void navigator.mediaDevices?.enumerateDevices().then((list) => setDevices(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')))
    load()
    navigator.mediaDevices?.addEventListener('devicechange', load)
    return () => navigator.mediaDevices?.removeEventListener('devicechange', load)
  }, [st.phase])
  const busy = st.phase !== 'idle'
  const mins = Math.floor(st.count / 60)
  const secs = String(st.count % 60).padStart(2, '0')
  return (
    <div className={s.panel}>
      <span className={s.hint}>{t('hint')}</span>
      <span className={s.label}>{t('mic')}</span>
      <Select<string>
        value={st.deviceId || 'default'}
        label={t('mic')}
        onChange={(id) => useRec.setState({ deviceId: id === 'default' ? '' : id })}
        options={[{ value: 'default', label: t('defaultMic') }, ...devices.map((d, i) => ({ value: d.deviceId, label: d.label || `${t('mic')} ${i + 1}` }))]}
      />
      <div className={s.row}>
        <span>{t('playVideo')}</span>
        <Switch checked={st.playVideo} label={t('playVideo')} disabled={busy} onChange={(playVideo) => useRec.setState({ playVideo })} />
      </div>
      <div className={s.row}>
        <span>{t('muteProject')}</span>
        <Switch checked={st.muteProject} label={t('muteProject')} disabled={busy} onChange={(muteProject) => useRec.setState({ muteProject })} />
      </div>
      <span className={s.hint}>{t('muteHint')}</span>
      <div className={s.row}>
        <span>{t('enhance')}</span>
        <Switch checked={st.enhance} label={t('enhance')} disabled={busy} onChange={(enhance) => useRec.setState({ enhance })} />
      </div>

      <div className={s.recorder} data-phase={st.phase}>
        {st.phase === 'countdown' && <span className={s.count}>{st.count}</span>}
        {st.phase === 'recording' && (
          <span className={s.time}>
            <span className={s.dot} /> {t('recording')} {mins}:{secs}
          </span>
        )}
        {st.phase === 'saving' && <span className={s.hint}>{t('saving')}</span>}
        {(st.phase === 'countdown' || st.phase === 'recording') && (
          <div className={s.level}>
            <div style={{ width: `${Math.min(100, Math.max(0, (20 * Math.log10(st.level || 1e-6) + 60) / 60) * 100)}%` }} />
          </div>
        )}
        {st.phase === 'idle' ? (
          <Button variant="primary" icon={<Mic />} onClick={() => void start()}>
            {t('start')}
          </Button>
        ) : (
          <Button variant={st.phase === 'recording' ? 'danger' : 'secondary'} icon={<Square />} disabled={st.phase === 'saving'} onClick={() => void stop()}>
            {st.phase === 'countdown' ? t('cancel') : t('stop')}
          </Button>
        )}
      </div>
    </div>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    {
      id: 'voiceover.toggle',
      title: () => tt('start'),
      keys: ['mod+shift+r'],
      keyLabel: 'Ctrl+Shift+R',
      enabled: () => !!useProject.getState().project,
      run: () => (useRec.getState().phase === 'idle' ? start() : stop())
    }
  ],
  panels: [{ id: 'voiceover', title: () => tt('panel'), icon: Mic, order: 38, Component: VoiceoverPanel }]
})
