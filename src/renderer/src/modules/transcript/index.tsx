import { Eraser, FileText, Scissors } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { Project } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { JobFailure, runJobWithComponents, useJobs } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useSettings } from '@renderer/core/store/settings'
import { seek } from '@renderer/engine/preview'
import { stringsT, useStrings } from '@renderer/i18n'
import { Button, Switch } from '@renderer/ui/controls'
import { Empty, Field, Progress } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import { removeRanges } from '../silence/detect'
import { FILLER_PROMPT, isFiller, removalsFor, speechClips, transcriptWords, type TranscriptWord } from './words'
import { Highlights } from './Highlights'
import { strings } from './strings'
import s from './transcript.module.css'

const tt = stringsT(strings)
const ID = 'transcript'

function TranscriptPanel() {
  const t = useStrings(strings)
  const project = useProject((st) => st.project!)
  const captions = useSettings((st) => st.settings.captions)
  const playhead = useEditor((st) => st.playhead)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [soft, setSoft] = useState(false)
  const [busy, setBusy] = useState(false)
  const [jobIds, setJobIds] = useState<string[]>([])
  const jobs = useJobs((st) => st.jobs)
  const anchor = useRef<number | null>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const clips = useMemo(() => speechClips(project), [project])
  const words = useMemo(() => transcriptWords(project), [project])
  const language = useMemo(() => clips.map((c) => project.assets[c.assetId]?.transcript?.language).find(Boolean) ?? 'tr', [clips, project])
  const fillers = useMemo(() => new Set(words.filter((w) => isFiller(w.text, language, soft)).map((w) => w.key)), [words, language, soft])
  const pending = clips.filter((c) => !project.assets[c.assetId]?.transcript)
  const progress = jobIds.map((id) => jobs[id]).find((j) => j?.status === 'running')?.progress ?? null

  const transcribe = async (all: boolean) => {
    const assets = [...new Set((all ? clips : pending).map((c) => c.assetId))].map((id) => project.assets[id]).filter(Boolean)
    setBusy(true)
    setJobIds([])
    try {
      for (const asset of assets) {
        const lang = captions.language === 'auto' ? 'tr' : captions.language
        const out = await runJobWithComponents(
          'captions.transcribe',
          { path: asset.path, start: 0, duration: asset.duration, language: captions.language, model: captions.model, prompt: FILLER_PROMPT[lang] },
          t('job', { name: asset.name }),
          (id) => setJobIds((prev) => [...prev, id])
        )
        projectActions.apply(
          t('transcribe'),
          (d) => {
            const a = d.assets[asset.id]
            if (a) a.transcript = { language: out.language, model: captions.model, words: out.words }
          },
          ID
        )
      }
      if (!transcriptWords(useProject.getState().project!).length) toast.info(t('noWords'))
    } catch (err) {
      if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(t('failed'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cut = (keys: ReadonlySet<string>) => {
    const p = useProject.getState().project!
    const removals = removalsFor(p, transcriptWords(p), keys)
    const count = removals.reduce((n, r) => n + r.ranges.length, 0)
    if (!count) return
    if (projectActions.apply(t('cut'), (d) => removeRanges(d as Project, removals, true), ID)) {
      setSelected(new Set())
      editorActions.select([])
      toast.success(t('removed', { count }))
    }
  }

  const selectRange = (from: number, to: number) => {
    const [a, b] = from <= to ? [from, to] : [to, from]
    setSelected(new Set(words.slice(a, b + 1).map((w) => w.key)))
  }

  const onWordDown = (e: React.PointerEvent, index: number, word: TranscriptWord) => {
    e.preventDefault()
    // Keep keyboard focus here so Delete cuts the selected words.
    textRef.current?.focus()
    if (e.shiftKey && anchor.current !== null) return selectRange(anchor.current, index)
    anchor.current = index
    dragging.current = true
    setSelected(new Set())
    seek(word.start)
    const up = () => {
      dragging.current = false
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      // Keep the global "delete clip" shortcut from also firing.
      e.preventDefault()
      e.stopPropagation()
      cut(selected)
    }
  }

  if (!clips.length) return <Empty icon={<FileText />} title={t('empty')} />

  return (
    <div className={s.panel}>
      <Button variant={pending.length ? 'primary' : 'secondary'} size="sm" icon={<FileText />} disabled={busy} onClick={() => void transcribe(!pending.length)}>
        {busy ? t('working') : pending.length ? t('transcribe') : t('retranscribe')}
      </Button>
      {busy && <Progress value={progress} />}
      {!words.length ? (
        <p className={s.hint}>{pending.length ? t('notYet') : t('noWords')}</p>
      ) : (
        <>
          <div className={s.toolbar}>
            <span className={s.count}>{fillers.size ? t('fillerCount', { count: fillers.size }) : t('noFillers')}</span>
            <Button size="sm" icon={<Eraser />} disabled={!fillers.size} onClick={() => cut(fillers)}>
              {t('removeFillers')}
            </Button>
          </div>
          <Field label={t('softFillers')}>
            <Switch checked={soft} label={t('softFillers')} onChange={setSoft} />
          </Field>
          <div ref={textRef} className={s.text} tabIndex={0} onKeyDown={onKeyDown} data-transcript="true">
            {words.map((w, i) => (
              <span
                key={w.key}
                className={s.word}
                data-selected={selected.has(w.key)}
                data-filler={fillers.has(w.key)}
                data-current={playhead >= w.start && playhead < w.end}
                onPointerDown={(e) => onWordDown(e, i, w)}
                onPointerEnter={() => dragging.current && anchor.current !== null && selectRange(anchor.current, i)}
              >
                {w.text}
              </span>
            ))}
          </div>
          <div className={s.toolbar}>
            <span className={s.count}>{selected.size ? t('selected', { count: selected.size }) : ''}</span>
            <Button size="sm" icon={<Scissors />} disabled={!selected.size} onClick={() => cut(selected)}>
              {t('deleteSelected')}
            </Button>
          </div>
          <p className={s.hint}>{t('hint')}</p>
          <Highlights />
        </>
      )}
    </div>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'transcript', title: () => tt('panel'), icon: FileText, order: 32, Component: TranscriptPanel }]
})
