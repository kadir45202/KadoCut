import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import type { Clip, Transform } from '@shared/project/schema'
import { defaultTransform } from '@shared/project/defaults'
import { editClip } from '@renderer/core/modules/edit'
import { AnimatedField } from '@renderer/core/modules/fields'
import { defineModule } from '@renderer/core/modules/types'
import { hasTransform } from '@renderer/core/project/clip'
import { useEditor } from '@renderer/core/store/editor'
import { useProject } from '@renderer/core/store/project'
import { seek } from '@renderer/engine/preview'
import { translate, useStrings } from '@renderer/i18n'
import { strings, transformT } from './strings'
import { Button, IconButton } from '@renderer/ui/controls'
import { Section } from '@renderer/ui/layout'
import { TransformOverlay } from './TransformOverlay'

const ID = 'transform'

type Key = keyof Transform
const tf = (c: Clip) => (c as Extract<Clip, { transform: Transform }>).transform

/** Every keyframe time of the transform, sorted (for previous/next navigation). */
function keyTimes(clip: Clip): number[] {
  const set = new Set<number>()
  for (const prop of Object.values(tf(clip))) for (const k of prop.keys) set.add(clip.start + k.t)
  return [...set].sort((a, b) => a - b)
}

function TransformSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const settings = useProject((st) => st.project!.settings)
  const asset = useProject((st) => ('assetId' in clip ? st.project!.assets[clip.assetId] : undefined))
  const playhead = useEditor((st) => st.playhead)
  const times = keyTimes(clip)
  const prev = [...times].reverse().find((x) => x < playhead - 1e-4)
  const next = times.find((x) => x > playhead + 1e-4)

  const field = (key: Key, label: string, opts: Partial<React.ComponentProps<typeof AnimatedField>>) => (
    <AnimatedField
      moduleId={ID}
      clip={clip}
      label={label}
      get={(c) => tf(c)[key]}
      set={(c, v) => void ((c as Extract<Clip, { transform: Transform }>).transform[key] = v)}
      {...opts}
    />
  )

  // "Fill" covers the canvas: ratio between cover and contain scale.
  const fillScale = asset && asset.width && asset.height ? Math.max(settings.width / asset.width, settings.height / asset.height) / Math.min(settings.width / asset.width, settings.height / asset.height) : 1
  const setStatic = (label: string, patch: Partial<Record<Key, number>>) =>
    editClip(ID, clip.id, label, (c) => {
      const tr = (c as Extract<Clip, { transform: Transform }>).transform
      for (const [k, v] of Object.entries(patch)) tr[k as Key] = { value: v as number, keys: [] }
    })

  return (
    <Section
      title={t('section')}
      actions={
        <>
          <IconButton small label={translate('keyframe.prev')} disabled={prev === undefined} onClick={() => prev !== undefined && seek(prev)}>
            <ChevronLeft />
          </IconButton>
          <IconButton small label={translate('keyframe.next')} disabled={next === undefined} onClick={() => next !== undefined && seek(next)}>
            <ChevronRight />
          </IconButton>
          <IconButton
            small
            label={t('reset')}
            onClick={() =>
              editClip(ID, clip.id, t('reset'), (c) => {
                ;(c as Extract<Clip, { transform: Transform }>).transform = defaultTransform()
              })
            }
          >
            <RotateCcw />
          </IconButton>
        </>
      }
    >
      {field('x', t('x'), { toDisplay: (v) => v * settings.width, fromDisplay: (v) => v / settings.width, unit: 'px' })}
      {field('y', t('y'), { toDisplay: (v) => v * settings.height, fromDisplay: (v) => v / settings.height, unit: 'px' })}
      {field('scale', t('scale'), { toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100, unit: '%', min: 1, max: 2000 })}
      {field('rotation', t('rotation'), { unit: '°', step: 0.5, precision: 1 })}
      {field('opacity', t('opacity'), { toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100, unit: '%', min: 0, max: 100 })}
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" onClick={() => setStatic(t('fit'), { scale: 1, x: 0, y: 0 })}>
            {t('fit')}
          </Button>
          <Button size="sm" onClick={() => setStatic(t('fill'), { scale: Math.round(fillScale * 1000) / 1000, x: 0, y: 0 })}>
            {t('fill')}
          </Button>
        </div>
      )}
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => transformT('name'),
  description: () => transformT('desc'),
  inspector: [
    { id: 'transform.video', tab: 'video', order: 10, when: (c) => c.kind !== 'audio' && c.kind !== 'text', Component: TransformSection },
    { id: 'transform.text', tab: 'text', order: 20, when: (c) => c.kind === 'text', Component: TransformSection }
  ],
  viewer: [{ id: 'transform.handles', order: 10, when: (c) => hasTransform(c), Component: TransformOverlay }]
})
