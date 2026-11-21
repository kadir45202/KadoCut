import { current, type Draft } from 'immer'
import { AudioLines, Unlink } from 'lucide-react'
import type { AudioClip, AudioProps, Clip, Project, VideoClip } from '@shared/project/schema'
import { addAsset, addAssetToTimeline, probeAsset } from '@renderer/core/media/import'
import { bindClipNumber, editClip } from '@renderer/core/modules/edit'
import { AnimatedField } from '@renderer/core/modules/fields'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { findOrCreateFreeTrack } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { runJob } from '@renderer/core/store/jobs'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { dbToGain, gainToDb } from '@renderer/lib/format'
import { ScrubNumber, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'

const strings = defineStrings({
  tr: {
    name: 'Ses',
    desc: 'Ses düzeyi, fade, sesi ayırma ve videodan ses çıkarma.',
    section: 'Ses',
    volume: 'Ses düzeyi',
    fadeIn: 'Fade in',
    fadeOut: 'Fade out',
    mute: 'Sessiz',
    detach: 'Sesi ayır',
    extract: 'Sesi çıkar (ses olarak ekle)',
    extracting: '{name} sesi çıkarılıyor',
    extractedName: '{name} (ses)',
    extractFailed: 'Ses çıkarılamadı',
    edit: 'Ses ayarı'
  },
  en: {
    name: 'Audio',
    desc: 'Volume, fades, detaching audio and extracting audio from videos.',
    section: 'Audio',
    volume: 'Volume',
    fadeIn: 'Fade in',
    fadeOut: 'Fade out',
    mute: 'Mute',
    detach: 'Detach audio',
    extract: 'Extract audio (add as audio)',
    extracting: 'Extracting audio from {name}',
    extractedName: '{name} (audio)',
    extractFailed: 'Could not extract audio',
    edit: 'Audio setting'
  }
})
const tt = stringsT(strings)
const ID = 'audio'

type Sound = VideoClip | AudioClip
export const isSound = (c: Clip, p: Project): c is Sound =>
  c.kind === 'audio' || (c.kind === 'video' && !c.audio.detached && !!p.assets[c.assetId]?.hasAudio)

function AudioSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const audio = (clip as Sound).audio
  const maxFade = Math.min(10, clip.duration / 2)
  const setAudio = (patch: Partial<AudioProps>) => editClip(ID, clip.id, t('edit'), (c) => void Object.assign((c as Draft<Sound>).audio, patch))

  return (
    <Section title={t('section')}>
      <AnimatedField
        moduleId={ID}
        clip={clip}
        label={t('volume')}
        get={(c) => (c as Sound).audio.volume}
        set={(c, v) => void ((c as Draft<Sound>).audio.volume = v)}
        toDisplay={(g) => Math.max(-60, gainToDb(g))}
        fromDisplay={dbToGain}
        unit="dB"
        step={0.5}
        min={-60}
        max={12}
        precision={1}
      />
      <Field label={t('fadeIn')}>
        <ScrubNumber
          value={audio.fadeIn}
          min={0}
          max={maxFade}
          step={0.05}
          precision={2}
          unit="s"
          {...bindClipNumber(ID, clip.id, t('fadeIn'), (c, v) => void ((c as Draft<Sound>).audio.fadeIn = v))}
        />
      </Field>
      <Field label={t('fadeOut')}>
        <ScrubNumber
          value={audio.fadeOut}
          min={0}
          max={maxFade}
          step={0.05}
          precision={2}
          unit="s"
          {...bindClipNumber(ID, clip.id, t('fadeOut'), (c, v) => void ((c as Draft<Sound>).audio.fadeOut = v))}
        />
      </Field>
      <Field label={t('mute')}>
        <Switch checked={audio.muted} label={t('mute')} onChange={(muted) => setAudio({ muted })} />
      </Field>
    </Section>
  )
}

function selectedVideoWithAudio(): VideoClip | undefined {
  const p = useProject.getState().project
  const sel = useEditor.getState().selection
  const c = p && sel.length === 1 ? p.clips[sel[0]] : undefined
  return c?.kind === 'video' && isSound(c, p!) ? c : undefined
}

/** Moves a video's sound to its own audio clip (same timing, speed and settings). */
function detach() {
  const video = selectedVideoWithAudio()
  if (!video) return
  let audioId = ''
  projectActions.apply(
    tt('detach'),
    (d) => {
      const v = d.clips[video.id] as Draft<VideoClip>
      // Drafts are proxies; snapshot before cloning.
      const snap = current(v) as VideoClip
      const track = findOrCreateFreeTrack(d as Project, 'audio', v.start, clipEnd(snap))
      const clip: AudioClip = {
        id: newId(),
        trackId: track.id,
        start: v.start,
        duration: v.duration,
        name: v.name,
        kind: 'audio',
        assetId: v.assetId,
        in: v.in,
        speed: structuredClone(snap.speed),
        audio: { ...structuredClone(snap.audio), detached: false }
      }
      d.clips[clip.id] = clip
      v.audio.detached = true
      audioId = clip.id
    },
    ID
  )
  if (audioId) editorActions.select([audioId])
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  inspector: [{ id: 'audio.section', tab: 'audio', order: 10, when: isSound, Component: AudioSection }],
  commands: [{ id: 'audio.detach', title: () => tt('detach'), enabled: () => !!selectedVideoWithAudio(), run: detach }],
  clipMenu: [{ command: 'audio.detach', icon: Unlink, order: 30, separatorBefore: true }],
  assetMenu: [
    {
      id: 'extract',
      title: () => tt('extract'),
      icon: AudioLines,
      order: 10,
      when: (a) => a.kind === 'video' && a.hasAudio,
      run: async (source) => {
        const project = useProject.getState().project!
        try {
          const out = await runJob('audio.extract', { projectId: project.id, path: source.path }, tt('extracting', { name: source.name }))
          const asset = await probeAsset(out.path, {
            name: tt('extractedName', { name: source.name }),
            hidden: false,
            derived: { kind: 'extract', sourceAssetId: source.id, params: {} },
            beats: [],
            transcript: null
          })
          if (addAsset(asset, tt('extract'), ID)) addAssetToTimeline(asset)
        } catch (err) {
          toast.error(tt('extractFailed'), err instanceof Error ? err.message : String(err))
        }
      }
    }
  ]
})
