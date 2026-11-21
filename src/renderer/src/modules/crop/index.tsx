import type { Draft } from 'immer'
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCcwSquare, RotateCwSquare } from 'lucide-react'
import type { Clip, Crop, ImageClip, VideoClip } from '@shared/project/schema'
import { defaultCrop } from '@shared/project/defaults'
import { bindClipNumber, editClip, localPlayhead } from '@renderer/core/modules/edit'
import { defineModule } from '@renderer/core/modules/types'
import { evalAnimated, setAnimatedValue } from '@renderer/core/project/keyframes'
import { useProject } from '@renderer/core/store/project'
import { useStrings } from '@renderer/i18n'
import { Button, IconButton, ScrubNumber, Switch } from '@renderer/ui/controls'
import { Field, Section } from '@renderer/ui/layout'
import { CropOverlay } from './CropOverlay'
import { useCropMode } from './mode'
import { cropForRatio } from './ratio'
import { cropT, strings } from './strings'

const ID = 'crop'
type Visual = VideoClip | ImageClip
const isVisual = (c: Clip): c is Visual => c.kind === 'video' || c.kind === 'image'


type Ratio = 'free' | '1:1' | '9:16' | '4:5' | '16:9'
const RATIOS: Ratio[] = ['free', '1:1', '9:16', '4:5', '16:9']

function CropSection({ clip }: { clip: Clip }) {
  const t = useStrings(strings)
  const crop = (clip as Visual).crop
  const asset = useProject((st) => st.project!.assets[(clip as Visual).assetId])
  const editing = useCropMode((st) => st.clipId === clip.id)
  const set = (label: string, patch: Partial<Crop>) => editClip(ID, clip.id, label, (c) => void Object.assign((c as Draft<Visual>).crop, patch))
  const edge = (key: 'left' | 'top' | 'right' | 'bottom') => (
    <Field label={t(key)}>
      <ScrubNumber
        value={crop[key] * 100}
        min={0}
        max={95}
        step={0.5}
        precision={1}
        unit="%"
        {...bindClipNumber(ID, clip.id, t('edit'), (c, v) => void ((c as Draft<Visual>).crop[key] = v / 100))}
      />
    </Field>
  )
  const rotate = (delta: number) =>
    editClip(ID, clip.id, t('rotate'), (c) => {
      const tr = (c as Draft<Visual>).transform
      const local = localPlayhead(c as Clip)
      tr.rotation = setAnimatedValue(tr.rotation, local, Math.round(evalAnimated(tr.rotation, local) + delta))
    })
  const applyRatio = (ratio: Ratio) => {
    if (!asset?.width || !asset.height) return
    if (ratio === 'free') return set(t('ratio'), { left: 0, right: 0, top: 0, bottom: 0 })
    const [a, b] = ratio.split(':').map(Number)
    set(t('ratio'), cropForRatio(asset.width, asset.height, a / b))
  }

  return (
    <Section
      title={t('section')}
      actions={
        <IconButton small label={t('reset')} onClick={() => set(t('reset'), defaultCrop())}>
          <RotateCcw />
        </IconButton>
      }
    >
      <Field label={t('onCanvas')}>
        <Switch checked={editing} label={t('onCanvas')} onChange={(on) => useCropMode.setState({ clipId: on ? clip.id : null })} />
      </Field>
      <div style={{ display: 'flex', gap: 4 }}>
        {RATIOS.map((r) => (
          <Button key={r} size="sm" onClick={() => applyRatio(r)}>
            {r === 'free' ? t('free') : r}
          </Button>
        ))}
      </div>
      {edge('left')}
      {edge('top')}
      {edge('right')}
      {edge('bottom')}
      <div style={{ display: 'flex', gap: 4 }}>
        <IconButton label={t('rotateLeft')} onClick={() => rotate(-90)}>
          <RotateCcwSquare />
        </IconButton>
        <IconButton label={t('rotateRight')} onClick={() => rotate(90)}>
          <RotateCwSquare />
        </IconButton>
        <IconButton label={t('flipH')} active={crop.flipH} onClick={() => set(t('flipH'), { flipH: !crop.flipH })}>
          <FlipHorizontal2 />
        </IconButton>
        <IconButton label={t('flipV')} active={crop.flipV} onClick={() => set(t('flipV'), { flipV: !crop.flipV })}>
          <FlipVertical2 />
        </IconButton>
      </div>
    </Section>
  )
}

export default defineModule({
  id: ID,
  name: () => cropT('name'),
  description: () => cropT('desc'),
  inspector: [{ id: 'crop.section', tab: 'video', order: 20, when: isVisual, Component: CropSection }],
  viewer: [{ id: 'crop.handles', order: 30, when: isVisual, Component: CropOverlay }]
})
