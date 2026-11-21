import type { Draft } from 'immer'
import { Bookmark, Captions, Languages, Paintbrush, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { AudioClip, Clip, Project, TextClip, TextStyle, VideoClip } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd, retimeWords } from '@renderer/core/project/clip'
import { newId, textClip } from '@renderer/core/project/factory'
import { addTrack, mainTrack } from '@renderer/core/project/timeline'
import { useEditor } from '@renderer/core/store/editor'
import { JobFailure, runJobWithComponents, useJobs } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { audioPathFor } from '@renderer/engine/audio'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { sourceSpan } from '@renderer/core/project/speed'
import { Button, Segmented, Select, Slider, Switch, TextInput } from '@renderer/ui/controls'
import { ContextMenu } from '@renderer/ui/overlays'
import { Field, Progress, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { groupWords, wordsOnTimeline, type TimedWord } from './grouping'
import { BUILTIN_IDS, BUILTIN_STYLES, type BuiltinStyleId } from './styles'
import s from './captions.module.css'

const strings = defineStrings({
  tr: {
    name: 'Otomatik altyazı',
    desc: 'Konuşmayı Whisper ile yazıya döker; kelime kelime vurgulu altyazı oluşturur.',
    panel: 'Altyazı',
    scope: 'Kaynak',
    scopeMain: 'Ana parça',
    scopeSelected: 'Seçili klipler',
    language: 'Dil',
    auto: 'Otomatik',
    words: 'Kelime',
    style: 'Stil',
    generate: 'Altyazı oluştur',
    working: 'Konuşma yazıya dökülüyor…',
    job: '{name} yazıya dökülüyor',
    none: 'Seçilen kaynakta konuşma içeren klip yok.',
    noSpeech: 'Konuşma algılanamadı.',
    created: '{count} altyazı oluşturuldu',
    failed: 'Altyazı oluşturulamadı',
    remove: 'Tüm altyazıları sil',
    hint: 'İlk kullanımda Whisper modeli indirilir. İşlem bilgisayarında yapılır, ses dışarı gönderilmez.',
    applyAll: 'Bu stili tüm altyazılara uygula',
    captionStyle: 'Altyazı',
    'style.bold': 'Vurgulu',
    'style.box': 'Kutu vurgu',
    'style.pop': 'Büyüyen',
    'style.reveal': 'Kelime kelime',
    'style.boxed': 'Kutulu',
    'style.clean': 'Sade',
    'style.impact': 'Impact',
    'style.subtitle': 'Alt yazı',
    sample: 'BU BİR örnek',
    applyExisting: 'Mevcut altyazılara uygula',
    applied: 'Stil {count} altyazıya uygulandı',
    saveStyle: 'Stili kaydet',
    styleName: 'Stil adı',
    saved: '“{name}” kaydedildi',
    deleteStyle: 'Kayıtlı stili sil',
    myStyles: 'Kayıtlı stiller',
    translate: 'Altyazıları çevir',
    target: 'Hedef dil',
    asTrack: 'Yeni parçaya ekle (iki dilli)',
    translating: 'Çevriliyor…',
    translated: '{count} altyazı çevrildi',
    translatedLocal: '{count} altyazı yerel modelle çevrildi',
    translateFailed: 'Çeviri yapılamadı',
    translateHint: 'Claude API anahtarı varsa Claude ile, yoksa bilgisayarında yerel modelle çevrilir (ilk kullanımda ~1,7 GB indirilir).'
  },
  en: {
    name: 'Auto captions',
    desc: 'Transcribes speech with Whisper and builds word-highlighted captions.',
    panel: 'Captions',
    scope: 'Source',
    scopeMain: 'Main track',
    scopeSelected: 'Selected clips',
    language: 'Language',
    auto: 'Automatic',
    words: 'Words',
    style: 'Style',
    generate: 'Generate captions',
    working: 'Transcribing speech…',
    job: 'Transcribing {name}',
    none: 'No clips with speech in the selected source.',
    noSpeech: 'No speech detected.',
    created: '{count} captions created',
    failed: 'Captions could not be created',
    remove: 'Delete all captions',
    hint: 'The Whisper model downloads on first use. Runs on your computer; audio never leaves it.',
    applyAll: 'Apply this style to all captions',
    captionStyle: 'Captions',
    'style.bold': 'Bold',
    'style.box': 'Box highlight',
    'style.pop': 'Pop',
    'style.reveal': 'Word by word',
    'style.boxed': 'Boxed',
    'style.clean': 'Clean',
    'style.impact': 'Impact',
    'style.subtitle': 'Subtitle',
    sample: 'THIS IS an example',
    applyExisting: 'Apply to existing captions',
    applied: 'Style applied to {count} captions',
    saveStyle: 'Save style',
    styleName: 'Style name',
    saved: '“{name}” saved',
    deleteStyle: 'Delete saved style',
    myStyles: 'Saved styles',
    translate: 'Translate captions',
    target: 'Target language',
    asTrack: 'Add as a new track (bilingual)',
    translating: 'Translating…',
    translated: '{count} captions translated',
    translatedLocal: '{count} captions translated with the local model',
    translateFailed: 'Translation failed',
    translateHint: 'Uses Claude when an API key is set, otherwise a local model on your computer (~1.7 GB download on first use).'
  }
})
const tt = stringsT(strings)
const ID = 'captions'

/** Built-in id, or `custom:<id>` for a style saved in settings. */
type StyleRef = string

function resolveStyle(ref: StyleRef): TextStyle {
  if (ref.startsWith('custom:')) {
    const saved = useSettings.getState().settings.captions.styles.find((st) => `custom:${st.id}` === ref)
    if (saved) return { ...saved.style }
  }
  return (BUILTIN_STYLES[ref as BuiltinStyleId] ?? BUILTIN_STYLES.bold)()
}

/** Rough CSS rendition of a caption look for the style picker. */
function StyleSample({ style, sample }: { style: TextStyle; sample: string }) {
  const [first, ...rest] = sample.split(' ')
  const active: React.CSSProperties =
    style.highlightMode === 'box'
      ? { background: style.highlightColor, borderRadius: 3, padding: '0 3px' }
      : style.highlightMode === 'none'
        ? {}
        : { color: style.highlightColor, fontSize: style.highlightMode === 'scale' ? '1.18em' : undefined }
  return (
    <span
      className={s.sample}
      style={{
        fontFamily: `"${style.fontFamily}", "Segoe UI", sans-serif`,
        fontWeight: style.fontWeight,
        color: style.color,
        textTransform: style.uppercase ? 'uppercase' : undefined,
        WebkitTextStroke: style.strokeWidth ? `0.8px ${style.strokeColor}` : undefined,
        background: style.backgroundOpacity ? `rgba(0,0,0,${style.backgroundOpacity})` : undefined
      }}
    >
      <span style={active}>{first}</span> <span style={{ opacity: style.reveal === 'word' ? 0.25 : 1 }}>{rest.join(' ')}</span>
    </span>
  )
}

/** Gives every caption clip `style`; returns how many changed. */
function applyToAll(style: TextStyle, label: string): number {
  let count = 0
  projectActions.apply(
    label,
    (d) => {
      for (const c of Object.values(d.clips)) {
        if (c.kind !== 'text' || c.role !== 'caption') continue
        ;(c as Draft<TextClip>).style = { ...style }
        count++
      }
    },
    ID
  )
  return count
}

type Sound = VideoClip | AudioClip
const isSound = (c: Clip, p: Project): c is Sound =>
  (c.kind === 'audio' || (c.kind === 'video' && !c.audio.detached && !!p.assets[c.assetId]?.hasAudio)) && !c.audio.muted

function sources(p: Project, scope: 'main' | 'selected'): Sound[] {
  const selection = new Set(useEditor.getState().selection)
  const main = mainTrack(p).id
  return Object.values(p.clips)
    .filter((c): c is Sound => isSound(c, p) && (scope === 'main' ? c.trackId === main : selection.has(c.id)))
    .sort((a, b) => a.start - b.start)
}

function CaptionsPanel() {
  const t = useStrings(strings)
  const settings = useSettings((st) => st.settings.captions)
  const hasCaptions = useProject((st) => Object.values(st.project!.clips).some((c) => c.kind === 'text' && c.role === 'caption'))
  const [scope, setScope] = useState<'main' | 'selected'>('main')
  const [maxWords, setMaxWords] = useState(3)
  const [style, setStyle] = useState<StyleRef>('bold')
  const saved = useSettings((st) => st.settings.captions.styles)
  const [jobIds, setJobIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const jobs = useJobs((st) => st.jobs)
  const running = jobIds.map((id) => jobs[id]).filter((j) => j?.status === 'running')
  const progress = running.length ? running[0].progress : null

  const generate = async () => {
    const project = useProject.getState().project!
    const clips = sources(project, scope)
    if (!clips.length) return toast.info(t('none'))
    setBusy(true)
    setJobIds([])
    try {
      const all: TimedWord[] = []
      for (const clip of clips) {
        const path = audioPathFor(project, clip)
        if (!path) continue
        const out = await runJobWithComponents(
          'captions.transcribe',
          { path, start: clip.in, duration: sourceSpan(clip.speed, clip.duration), language: settings.language, model: settings.model },
          t('job', { name: clip.name }),
          (id) => setJobIds((prev) => [...prev, id])
        )
        all.push(...wordsOnTimeline(clip, out.words))
      }
      const chunks = groupWords(all.sort((a, b) => a.start - b.start), maxWords)
      if (!chunks.length) return toast.info(t('noSpeech'))
      const ranges = clips.map((c) => [c.start, clipEnd(c)] as const)
      projectActions.apply(
        t('generate'),
        (d) => {
          const draft = d as Project
          // Replace earlier captions in the same time range.
          for (const c of Object.values(draft.clips)) {
            if (c.kind === 'text' && c.role === 'caption' && ranges.some(([a, b]) => c.start < b && clipEnd(c) > a)) delete draft.clips[c.id]
          }
          const track = addTrack(draft, 'text')
          for (const chunk of chunks) {
            const clip = textClip(track.id, chunk.start, chunk.words.map((w) => w.text).join(' '), 'caption')
            clip.duration = chunk.end - chunk.start
            clip.style = resolveStyle(style)
            clip.words = chunk.words.map((w) => ({ text: w.text, start: Math.max(0, w.start - chunk.start), end: Math.min(clip.duration, w.end - chunk.start) }))
            draft.clips[clip.id] = clip
          }
        },
        ID
      )
      toast.success(t('created', { count: chunks.length }))
    } catch (err) {
      if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(t('failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const removeAll = () =>
    projectActions.apply(
      t('remove'),
      (d) => {
        for (const c of Object.values(d.clips)) if (c.kind === 'text' && c.role === 'caption') delete d.clips[c.id]
      },
      ID
    )

  return (
    <div className={s.panel}>
      <Field label={t('scope')}>
        <Segmented<'main' | 'selected'>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'main', label: t('scopeMain') },
            { value: 'selected', label: t('scopeSelected') }
          ]}
        />
      </Field>
      <Field label={t('language')}>
        <Select<'auto' | 'tr' | 'en'>
          value={settings.language}
          onChange={(language) => void settingsActions.update({ captions: { ...settings, language } })}
          options={[
            { value: 'auto', label: t('auto') },
            { value: 'tr', label: 'Türkçe' },
            { value: 'en', label: 'English' }
          ]}
        />
      </Field>
      <Field label={`${t('words')}: ${maxWords}`}>
        <Slider min={1} max={6} step={1} value={maxWords} onChange={setMaxWords} label={t('words')} />
      </Field>
      <div className={s.styles}>
        {BUILTIN_IDS.map((id) => (
          <button key={id} type="button" className={s.style} data-active={style === id} onClick={() => setStyle(id)}>
            <StyleSample style={BUILTIN_STYLES[id]()} sample={t('sample')} />
            <span className={s.styleName}>{t(`style.${id}`)}</span>
          </button>
        ))}
      </div>
      {saved.length > 0 && (
        <>
          <span className={s.groupTitle}>{t('myStyles')}</span>
          <div className={s.styles}>
            {saved.map((st) => (
              <ContextMenu
                key={st.id}
                items={[
                  {
                    id: 'delete',
                    label: t('deleteStyle'),
                    icon: <Trash2 />,
                    onSelect: () => void settingsActions.update({ captions: { ...settings, styles: saved.filter((x) => x.id !== st.id) } })
                  }
                ]}
              >
                <button type="button" className={s.style} data-active={style === `custom:${st.id}`} onClick={() => setStyle(`custom:${st.id}`)} title={st.name}>
                  <StyleSample style={st.style} sample={t('sample')} />
                  <span className={s.styleName}>{st.name}</span>
                </button>
              </ContextMenu>
            ))}
          </div>
        </>
      )}
      {hasCaptions && <TranslateSection />}
      {hasCaptions && (
        <Button size="sm" icon={<Paintbrush />} onClick={() => toast.success(t('applied', { count: applyToAll(resolveStyle(style), t('applyExisting')) }))}>
          {t('applyExisting')}
        </Button>
      )}
      <Button variant="primary" icon={<Captions />} disabled={busy} onClick={generate}>
        {busy ? t('working') : t('generate')}
      </Button>
      {busy && <Progress value={progress} />}
      <p className={s.hint}>{t('hint')}</p>
      {hasCaptions && (
        <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={removeAll}>
          {t('remove')}
        </Button>
      )}
    </div>
  )
}

const TARGETS = [
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Türkçe' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'es', label: 'Español' },
  { value: 'ar', label: 'العربية' },
  { value: 'ru', label: 'Русский' }
]

/** Translates every caption clip in place, or into a copy on a new track. */
function TranslateSection() {
  const t = useStrings(strings)
  const [target, setTarget] = useState(() => (useSettings.getState().settings.language === 'tr' ? 'en' : 'tr'))
  const [asTrack, setAsTrack] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const job = useJobs((st) => (jobId ? st.jobs[jobId] : undefined))
  const busy = jobId !== null
  const run = async () => {
    const p = useProject.getState().project!
    const caps = Object.values(p.clips)
      .filter((c): c is TextClip => c.kind === 'text' && c.role === 'caption')
      .sort((a, b) => a.start - b.start)
    setJobId('')
    try {
      const out = await runJobWithComponents('ai.translate', { lines: caps.map((c) => c.text), target }, t('translate'), setJobId)
      projectActions.apply(
        t('translate'),
        (d) => {
          const draft = d as Project
          const track = asTrack ? addTrack(draft, 'text') : null
          caps.forEach((c, i) => {
            const text = out.lines[i]
            const clip = (track ? { ...structuredClone(c), id: newId(), trackId: track.id } : draft.clips[c.id]) as Draft<TextClip>
            clip.words = retimeWords(clip as TextClip, text)
            clip.text = text
            clip.name = text.slice(0, 40)
            // The copy sits a little higher so both languages stay readable.
            if (track) clip.transform.y.value -= clip.style.fontSize * 2.2
            draft.clips[clip.id] = clip as TextClip
          })
        },
        ID
      )
      toast.success(t(out.provider === 'claude' ? 'translated' : 'translatedLocal', { count: caps.length }), out.warning)
    } catch (err) {
      if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(t('translateFailed'), err instanceof Error ? err.message : String(err))
    } finally {
      setJobId(null)
    }
  }
  return (
    <Section title={t('translate')} defaultOpen={false}>
      <Field label={t('target')}>
        <Select<string> value={target} onChange={setTarget} options={TARGETS} label={t('target')} />
      </Field>
      <Field label={t('asTrack')}>
        <Switch checked={asTrack} label={t('asTrack')} onChange={setAsTrack} />
      </Field>
      <Button size="sm" icon={<Languages />} disabled={busy} onClick={run}>
        {busy ? t('translating') : t('translate')}
      </Button>
      {busy && <Progress value={job?.progress ?? null} />}
      <p className={s.hint}>{t('translateHint')}</p>
    </Section>
  )
}

/** Inspector helper on caption clips: copy this clip's look to every caption, or save it. */
function CaptionStyleSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const caption = clip as TextClip
  const [name, setName] = useState('')
  const save = () => {
    const settings = useSettings.getState().settings.captions
    const label = (name.trim() || t('styleName')).slice(0, 60)
    void settingsActions.update({ captions: { ...settings, styles: [...settings.styles, { id: newId(), name: label, style: { ...caption.style } }] } })
    setName('')
    toast.success(t('saved', { name: label }))
  }
  return (
    <Section title={t('captionStyle')}>
      <Button
        size="sm"
        onClick={() =>
          projectActions.apply(
            t('applyAll'),
            (d) => {
              for (const c of Object.values(d.clips)) {
                if (c.kind !== 'text' || c.role !== 'caption' || c.id === caption.id) continue
                const target = c as Draft<TextClip>
                target.style = { ...caption.style }
                target.transform = structuredClone(caption.transform)
              }
            },
            ID
          )
        }
      >
        {t('applyAll')}
      </Button>
      <div className={s.saveRow}>
        <TextInput value={name} placeholder={t('styleName')} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <Button size="sm" icon={<Bookmark />} onClick={save}>
          {t('saveStyle')}
        </Button>
      </div>
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'captions', title: () => tt('panel'), icon: Captions, order: 30, Component: CaptionsPanel }],
  inspector: [{ id: 'captions.style', tab: 'text', order: 15, when: (c) => c.kind === 'text' && c.role === 'caption', Component: CaptionStyleSection }]
})
