import type { Draft } from 'immer'
import { Undo, X } from 'lucide-react'
import type { Clip, Project, VideoClip } from '@shared/project/schema'
import { probeAsset } from '@renderer/core/media/import'
import { clipJobKey, trackClipJob, useClipJob } from '@renderer/core/modules/clipJobs'
import { defineModule } from '@renderer/core/modules/types'
import { sourceSpan } from '@renderer/core/project/speed'
import { useEditor } from '@renderer/core/store/editor'
import { JobFailure, cancelJob, runJob, useJobs } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, translate, useStrings } from '@renderer/i18n'
import { IconButton, Switch } from '@renderer/ui/controls'
import { Field, Progress, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'

const strings = defineStrings({
  tr: {
    name: 'Ters oynat',
    desc: 'Klibi (görüntü ve ses) sondan başa doğru oynatır.',
    reverse: 'Ters oynat',
    section: 'Ters oynatma',
    job: '{name} ters çevriliyor',
    failed: 'Ters çevrilemedi',
    hint: 'Klibin kullanılan bölümü bir kez işlenir ve projede saklanır.',
    note: 'Arka plan silme, sabitleme ve gürültü azaltma ters klip için yeniden açılmalı.'
  },
  en: {
    name: 'Reverse',
    desc: 'Plays a clip (picture and sound) backwards.',
    reverse: 'Reverse',
    section: 'Reverse',
    job: 'Reversing {name}',
    failed: 'Reversing failed',
    hint: 'The part of the media the clip uses is processed once and kept in the project.',
    note: 'Background removal, stabilization and noise reduction need to be turned on again for the reversed clip.'
  }
})
const tt = stringsT(strings)
const ID = 'reverse'

/** The reversed render a clip plays, if any. */
const reversedAsset = (p: Project, clip: VideoClip) => {
  const a = p.assets[clip.assetId]
  return a?.derived?.kind === 'reversed' ? a : null
}

/** Renders made from the forward media no longer match; switch them off. */
function dropDerived(c: Draft<VideoClip>) {
  c.bgRemoval = { enabled: false, assetId: '' }
  c.stabilize = { ...c.stabilize, enabled: false, assetId: '' }
  c.audio.denoise = { ...c.audio.denoise, enabled: false, assetId: '' }
}

async function toggle(clip: VideoClip) {
  const project = useProject.getState().project!
  const current = reversedAsset(project, clip)
  if (current) {
    // Back to the original media at the same source range.
    const sourceId = current.derived!.sourceAssetId
    const start = Number(current.derived!.params.start) || 0
    return projectActions.apply(
      tt('reverse'),
      (d) => {
        const c = d.clips[clip.id] as Draft<VideoClip> | undefined
        if (!c || !d.assets[sourceId]) return
        c.assetId = sourceId
        c.in = start
        dropDerived(c)
      },
      ID
    )
  }
  const source = project.assets[clip.assetId]
  const start = clip.in
  const duration = Math.min(sourceSpan(clip.speed, clip.duration), Math.max(0.05, source.duration - start))
  // The same range reversed before (e.g. on a split part) is reused.
  const existing = Object.values(project.assets).find(
    (a) => a.derived?.kind === 'reversed' && a.derived.sourceAssetId === source.id && Math.abs(Number(a.derived.params.start) - start) < 1e-3 && Math.abs(Number(a.derived.params.duration) - duration) < 1e-3
  )
  const key = clipJobKey(ID, clip.id)
  try {
    const asset =
      existing ??
      (await probeAsset(
        (
          await runJob('video.reverse', { projectId: project.id, path: source.path, start, duration, hasAudio: source.hasAudio }, tt('job', { name: source.name }), (id) =>
            trackClipJob(key, id)
          )
        ).path,
        { name: `${source.name} (reversed)`, hidden: true, derived: { kind: 'reversed', sourceAssetId: source.id, params: { start, duration } }, beats: [], transcript: null }
      ))
    projectActions.apply(
      tt('reverse'),
      (d) => {
        d.assets[asset.id] ??= asset
        const c = d.clips[clip.id] as Draft<VideoClip> | undefined
        if (!c) return
        c.assetId = asset.id
        c.in = 0
        dropDerived(c)
      },
      ID
    )
  } catch (err) {
    if (!(err instanceof JobFailure && err.error.code === 'cancelled')) toast.error(tt('failed'), err instanceof Error ? err.message : String(err))
  } finally {
    trackClipJob(key, null)
  }
}

function selectedVideo(): VideoClip | null {
  const { selection } = useEditor.getState()
  const clip = selection.length === 1 ? useProject.getState().project?.clips[selection[0]] : undefined
  return clip?.kind === 'video' ? clip : null
}

function ReverseSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const video = clip as VideoClip
  const reversed = useProject((st) => !!reversedAsset(st.project!, video))
  const job = useClipJob(clipJobKey(ID, clip.id))
  return (
    <Section title={t('section')} defaultOpen={reversed}>
      <Field label={t('reverse')}>
        <Switch checked={reversed} disabled={!!job} label={t('reverse')} onChange={() => void toggle(video)} />
      </Field>
      {job ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1 }}>
            <Progress value={job.progress > 0 ? job.progress : null} />
          </div>
          <IconButton small label={translate('common.cancel')} onClick={() => void cancelJob(job.id)}>
            <X />
          </IconButton>
        </div>
      ) : (
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{reversed ? t('note') : t('hint')}</div>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    {
      id: 'reverse.toggle',
      title: () => tt('reverse'),
      enabled: () => {
        const clip = selectedVideo()
        return !!clip && !Object.values(useJobs.getState().jobs).some((j) => j.kind === 'video.reverse' && j.status === 'running')
      },
      run: () => {
        const clip = selectedVideo()
        if (clip) void toggle(clip)
      }
    }
  ],
  clipMenu: [{ command: 'reverse.toggle', icon: Undo, order: 22 }],
  inspector: [{ id: 'reverse.section', tab: 'speed', order: 30, when: (c) => c.kind === 'video', Component: ReverseSection }]
})
