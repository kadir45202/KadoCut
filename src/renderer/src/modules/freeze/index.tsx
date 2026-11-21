import { Snowflake } from 'lucide-react'
import type { Asset, ImageClip, Project, VideoClip } from '@shared/project/schema'
import { animated, defaultBgRemoval, defaultAnim } from '@shared/project/defaults'
import { defineModule } from '@renderer/core/modules/types'
import { clipEnd, snapToFrame, sourceTimeAt, splitClip } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { evalAnimated } from '@renderer/core/project/keyframes'
import { rippleTrack } from '@renderer/core/project/timeline'
import { runJob } from '@renderer/core/store/jobs'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT } from '@renderer/i18n'
import { toast } from '@renderer/ui/toast'

const strings = defineStrings({
  tr: {
    name: 'Kareyi dondur',
    desc: 'Oynatma çizgisindeki kareyi 3 saniyelik bir fotoğrafa dönüştürür.',
    freeze: 'Kareyi dondur',
    job: 'Kare donduruluyor',
    frame: '{name} — donmuş kare',
    failed: 'Kare dondurulamadı'
  },
  en: {
    name: 'Freeze frame',
    desc: 'Turns the frame at the playhead into a 3 second still.',
    freeze: 'Freeze frame',
    job: 'Freezing frame',
    frame: '{name} — freeze frame',
    failed: 'Could not freeze the frame'
  }
})
const t = stringsT(strings)
const ID = 'freeze'
const FREEZE_SECONDS = 3

/** The video clip to freeze: selected one under the playhead, else the main-track clip there. */
function target(): VideoClip | null {
  const p = useProject.getState().project
  if (!p) return null
  const time = useEditor.getState().playhead
  const under = Object.values(p.clips).filter((c): c is VideoClip => c.kind === 'video' && time >= c.start && time < clipEnd(c))
  const selection = new Set(useEditor.getState().selection)
  const main = p.tracks.find((tr) => tr.main)!.id
  return under.find((c) => selection.has(c.id)) ?? under.find((c) => c.trackId === main) ?? under[0] ?? null
}

async function freeze() {
  const clip = target()
  const p = useProject.getState().project
  if (!clip || !p) return
  const source = p.assets[clip.assetId]
  const time = snapToFrame(useEditor.getState().playhead, p.settings.fps)
  try {
    const out = await runJob('media.freezeFrame', { projectId: p.id, path: source.path, time: sourceTimeAt(clip, time) }, t('job'))
    const asset: Asset = {
      id: newId(),
      kind: 'image',
      name: t('frame', { name: source.name }),
      path: out.path,
      duration: 0,
      width: out.width,
      height: out.height,
      fps: 0,
      hasAudio: false,
      hasVideo: true,
      hidden: false,
      derived: { kind: 'freeze', sourceAssetId: source.id, params: { time } },
      beats: [],
      transcript: null
    }
    let frameId = ''
    projectActions.apply(
      t('freeze'),
      (d) => {
        const draft = d as Project
        const current = draft.clips[clip.id] as VideoClip | undefined
        if (!current) throw new Error('Clip was removed')
        draft.assets[asset.id] = asset
        const local = time - current.start
        // Same framing as the video at that instant, as a still.
        const frame: ImageClip = {
          id: newId(),
          trackId: current.trackId,
          start: time,
          duration: FREEZE_SECONDS,
          name: asset.name,
          kind: 'image',
          assetId: asset.id,
          transform: {
            x: animated(evalAnimated(current.transform.x, local)),
            y: animated(evalAnimated(current.transform.y, local)),
            scale: animated(evalAnimated(current.transform.scale, local)),
            rotation: animated(evalAnimated(current.transform.rotation, local)),
            opacity: animated(evalAnimated(current.transform.opacity, local))
          },
          mask: { ...current.mask },
          bgRemoval: defaultBgRemoval(),
          chroma: { ...current.chroma },
          transition: null,
          blend: current.blend,
          color: { ...current.color },
          crop: { ...current.crop },
          anim: defaultAnim()
        }
        const parts = splitClip(current, time, newId(), draft.settings.fps)
        if (parts) {
          draft.clips[parts[0].id] = parts[0]
          draft.clips[parts[1].id] = parts[1]
        }
        // Make room: everything from the freeze point moves right by the still's length.
        rippleTrack(draft, current.trackId, time, FREEZE_SECONDS)
        draft.clips[frame.id] = frame
        frameId = frame.id
      },
      ID
    )
    if (frameId) editorActions.select([frameId])
  } catch (err) {
    toast.error(t('failed'), err instanceof Error ? err.message : String(err))
  }
}

export default defineModule({
  id: ID,
  name: () => t('name'),
  description: () => t('desc'),
  commands: [{ id: 'freeze.frame', title: () => t('freeze'), enabled: () => !!target(), run: freeze }],
  toolbar: [{ command: 'freeze.frame', icon: Snowflake, order: 20 }],
  clipMenu: [{ command: 'freeze.frame', icon: Snowflake, order: 20 }]
})
