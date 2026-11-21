import { ScissorsLineDashed } from 'lucide-react'
import { useMemo, useState } from 'react'
import { create } from 'zustand'
import type { Clip, Project } from '@shared/project/schema'
import { useMedia } from '@renderer/core/media/media'
import { defineModule } from '@renderer/core/modules/types'
import { sourceRange, type MediaClip } from '@renderer/core/project/clip'
import { mainTrack } from '@renderer/core/project/timeline'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { audioPathFor } from '@renderer/engine/audio'
import { defineStrings, stringsT, translate, useStrings } from '@renderer/i18n'
import { Button, Segmented, Slider, Switch } from '@renderer/ui/controls'
import { Field } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import { findSilences, removeRanges, toTimeline, type Removal, type SilenceOptions } from './detect'

const strings = defineStrings({
  tr: {
    name: 'Sessizlik temizleyici',
    desc: 'Konuşma arasındaki sessiz boşlukları bulup tek tıkla keser (jump cut).',
    open: 'Sessizlikleri kaldır',
    title: 'Sessizlikleri kaldır',
    scope: 'Kaynak',
    scopeMain: 'Ana parça',
    scopeSelected: 'Seçili klipler',
    threshold: 'Sessizlik eşiği',
    minSilence: 'En kısa boşluk',
    padding: 'Kenar payı',
    shiftOthers: 'Diğer parçaları da kaydır',
    summary: '{count} sessiz bölüm · {seconds} sn kısalacak',
    none: 'Bu ayarlarla kaldırılacak sessizlik bulunamadı.',
    pending: 'Ses analizi henüz bitmedi; birkaç saniye sonra tekrar dene.',
    apply: 'Kaldır',
    done: '{count} sessiz bölüm kaldırıldı',
    hint: 'İpucu: altyazıları sessizlikleri kaldırdıktan sonra oluştur.'
  },
  en: {
    name: 'Silence remover',
    desc: 'Finds silent pauses between speech and cuts them in one click (jump cut).',
    open: 'Remove silences',
    title: 'Remove silences',
    scope: 'Source',
    scopeMain: 'Main track',
    scopeSelected: 'Selected clips',
    threshold: 'Silence threshold',
    minSilence: 'Shortest pause',
    padding: 'Padding',
    shiftOthers: 'Shift other tracks too',
    summary: '{count} silent parts · {seconds} s shorter',
    none: 'No silences to remove with these settings.',
    pending: 'Audio analysis is still running; try again in a few seconds.',
    apply: 'Remove',
    done: '{count} silent parts removed',
    hint: 'Tip: generate captions after removing silences.'
  }
})
const tt = stringsT(strings)
const ID = 'silence'

const useDialog = create<{ open: boolean }>(() => ({ open: false }))

const isOwnSound = (c: Clip, p: Project): c is MediaClip =>
  c.kind === 'audio' || (c.kind === 'video' && !c.audio.detached && !!p.assets[c.assetId]?.hasAudio)

function targets(p: Project, scope: 'main' | 'selected'): MediaClip[] {
  const selection = new Set(useEditor.getState().selection)
  const main = mainTrack(p).id
  return Object.values(p.clips).filter((c): c is MediaClip => isOwnSound(c, p) && (scope === 'main' ? c.trackId === main : selection.has(c.id)))
}

function SilenceDialog() {
  const t = useStrings(strings)
  const open = useDialog((st) => st.open)
  const project = useProject((st) => st.project!)
  const audio = useMedia((st) => st.audio)
  const [scope, setScope] = useState<'main' | 'selected'>(() => (useEditor.getState().selection.length ? 'selected' : 'main'))
  const [opts, setOpts] = useState<SilenceOptions>({ thresholdDb: -38, minSilence: 0.5, padding: 0.12 })
  const [shiftOthers, setShiftOthers] = useState(true)

  const plan = useMemo(() => {
    if (!open) return { removals: [] as Removal[], count: 0, seconds: 0, pending: false }
    let pending = false
    const removals: Removal[] = []
    for (const clip of targets(project, scope)) {
      const info = audio[audioPathFor(project, clip) ?? '']
      if (!info?.peaks || !info.data) {
        pending = true
        continue
      }
      const [from, to] = sourceRange(clip)
      const ranges = toTimeline(clip, findSilences(info.peaks, info.data.peaksPerSecond, from, to, opts))
      if (ranges.length) removals.push({ clipId: clip.id, ranges })
    }
    const all = removals.flatMap((r) => r.ranges)
    return { removals, count: all.length, seconds: all.reduce((s, [a, b]) => s + b - a, 0), pending }
  }, [open, project, audio, scope, opts])

  const close = () => useDialog.setState({ open: false })
  const apply = () => {
    const ok = projectActions.apply(t('open'), (d) => removeRanges(d as Project, plan.removals, shiftOthers), ID)
    if (ok) {
      editorActions.select([])
      toast.success(t('done', { count: plan.count }))
      close()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title={t('title')}
      footer={
        <>
          <Button onClick={close}>{translate('common.cancel')}</Button>
          <Button variant="primary" disabled={!plan.count} onClick={apply}>
            {t('apply')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
        <Field label={`${t('threshold')}: ${opts.thresholdDb} dB`}>
          <Slider min={-60} max={-20} step={1} value={opts.thresholdDb} onChange={(thresholdDb) => setOpts({ ...opts, thresholdDb })} label={t('threshold')} />
        </Field>
        <Field label={`${t('minSilence')}: ${opts.minSilence.toFixed(1)} s`}>
          <Slider min={0.2} max={2} step={0.1} value={opts.minSilence} onChange={(minSilence) => setOpts({ ...opts, minSilence })} label={t('minSilence')} />
        </Field>
        <Field label={`${t('padding')}: ${opts.padding.toFixed(2)} s`}>
          <Slider min={0} max={0.3} step={0.01} value={opts.padding} onChange={(padding) => setOpts({ ...opts, padding })} label={t('padding')} />
        </Field>
        <Field label={t('shiftOthers')}>
          <Switch checked={shiftOthers} onChange={setShiftOthers} label={t('shiftOthers')} />
        </Field>
        <div style={{ color: plan.count ? 'var(--text-1)' : 'var(--text-3)' }}>
          {plan.pending ? t('pending') : plan.count ? t('summary', { count: plan.count, seconds: plan.seconds.toFixed(1) }) : t('none')}
        </div>
        <div style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)' }}>{t('hint')}</div>
      </div>
    </Dialog>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [{ id: 'silence.open', title: () => tt('open'), enabled: () => !!useProject.getState().project, run: () => useDialog.setState({ open: true }) }],
  toolbar: [{ command: 'silence.open', icon: ScissorsLineDashed, order: 30 }],
  dialogs: [{ id: 'silence.dialog', Component: SilenceDialog }]
})
