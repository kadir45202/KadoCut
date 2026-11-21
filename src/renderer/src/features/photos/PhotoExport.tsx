import { useMemo, useState } from 'react'
import { CircleCheck, FolderOpen } from 'lucide-react'
import { create } from 'zustand'
import { usePhotos } from '@renderer/core/store/photos'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { encodePhoto, exportName, type ExportFormat as Format, type Watermark } from '@renderer/engine/photo/export'
import { useT } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { Button, Segmented, Select, Slider, Switch, TextInput } from '@renderer/ui/controls'
import { Field, Progress } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'
import s from './photos.module.css'

/** Export choices, kept for the session so the next export starts from them. */
const usePrefs = create<{ format: Format; quality: number; edge: string; name: string; watermark: Watermark & { on: boolean } }>(() => ({
  format: 'jpg',
  quality: 90,
  edge: '0',
  name: '',
  watermark: { on: false, text: '', position: 'br', size: 4, opacity: 0.8 }
}))

export function PhotoExport({ ids, open, onOpenChange }: { ids: string[]; open: boolean; onOpenChange(o: boolean): void }) {
  const t = useT()
  const all = usePhotos((st) => st.catalog?.photos)
  const photos = useMemo(() => (all ?? []).filter((p) => ids.includes(p.id)), [all, ids])
  const lastDir = useSettings((st) => st.settings.lastExportDir)
  const { format, quality, edge, name, watermark } = usePrefs()
  const setFormat = (format: Format) => usePrefs.setState({ format })
  const setQuality = (quality: number) => usePrefs.setState({ quality })
  const setEdge = (edge: string) => usePrefs.setState({ edge })
  const setMark = (patch: Partial<typeof watermark>) => usePrefs.setState({ watermark: { ...watermark, ...patch } })
  const [phase, setPhase] = useState<{ kind: 'setup' } | { kind: 'running'; done: number } | { kind: 'done'; dir: string; count: number; failed: string[] }>({ kind: 'setup' })

  const start = async () => {
    const dir = lastDir || (await api.photos.pickFolder())
    if (!dir) return
    setPhase({ kind: 'running', done: 0 })
    const failed: string[] = []
    let written = ''
    for (const [i, photo] of photos.entries()) {
      try {
        const data = await encodePhoto(photo, { format, quality, longEdge: Number(edge), watermark: watermark.on ? watermark : null })
        written = await api.photos.writeExport(dir, `${exportName(photo.name, i, name)}.${format}`, data)
      } catch (err) {
        log.warn('photos', `export failed for ${photo.name}: ${String(err)}`)
        failed.push(photo.name)
      }
      setPhase({ kind: 'running', done: i + 1 })
    }
    setPhase({ kind: 'done', dir: written || dir, count: photos.length - failed.length, failed })
  }

  const close = (o: boolean) => {
    if (phase.kind === 'running') return
    if (!o) setPhase({ kind: 'setup' })
    onOpenChange(o)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('photo.exportTitle', { count: photos.length })}
      footer={
        phase.kind === 'done' ? (
          <>
            <Button icon={<FolderOpen />} onClick={() => void api.app.revealPath(phase.dir)}>
              {t('home.reveal')}
            </Button>
            <Button variant="primary" onClick={() => close(false)}>
              {t('common.close')}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => close(false)} disabled={phase.kind === 'running'}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" disabled={phase.kind === 'running' || !photos.length} onClick={() => void start()}>
              {t('photo.exportStart')}
            </Button>
          </>
        )
      }
    >
      {phase.kind === 'done' ? (
        <div className={s.exportDone}>
          <CircleCheck />
          <div>
            <div>{t('photo.exportDone', { count: phase.count })}</div>
            {phase.failed.length > 0 && <div className={s.hint}>{t('photo.exportFailed', { names: phase.failed.join(', ') })}</div>}
          </div>
        </div>
      ) : phase.kind === 'running' ? (
        <div className={s.exportRun}>
          <span>{t('photo.exporting', { done: phase.done, total: photos.length })}</span>
          <Progress value={photos.length ? phase.done / photos.length : null} />
        </div>
      ) : (
        <div className={s.exportForm}>
          <Field label={t('photo.format')}>
            <Segmented<Format>
              value={format}
              onChange={setFormat}
              options={[
                { value: 'jpg', label: 'JPEG' },
                { value: 'png', label: 'PNG' }
              ]}
            />
          </Field>
          {format === 'jpg' && (
            <Field label={`${t('photo.quality')} (${quality})`}>
              <Slider min={50} max={100} step={1} value={quality} label={t('photo.quality')} onChange={setQuality} />
            </Field>
          )}
          <Field label={t('photo.longEdge')}>
            <Select<string>
              value={edge}
              label={t('photo.longEdge')}
              onChange={setEdge}
              options={[
                { value: '0', label: t('photo.fullSize') },
                { value: '4096', label: '4096 px' },
                { value: '2048', label: '2048 px' },
                { value: '1350', label: t('photo.edgeInstagram') },
                { value: '1080', label: '1080 px' }
              ]}
            />
          </Field>
          <Field label={t('photo.fileName')}>
            <TextInput value={name} placeholder={t('photo.fileNameOriginal')} aria-label={t('photo.fileName')} onChange={(e) => usePrefs.setState({ name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label={t('photo.watermark')}>
            <Switch checked={watermark.on} label={t('photo.watermark')} onChange={(on) => setMark({ on })} />
          </Field>
          {watermark.on && (
            <>
              <Field label={t('photo.watermarkText')}>
                <TextInput value={watermark.text} placeholder="© " aria-label={t('photo.watermarkText')} onChange={(e) => setMark({ text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              </Field>
              <Field label={t('photo.watermarkPosition')}>
                <Select<Watermark['position']>
                  value={watermark.position}
                  label={t('photo.watermarkPosition')}
                  onChange={(position) => setMark({ position })}
                  options={(['br', 'bl', 'tr', 'tl', 'center'] as const).map((v) => ({ value: v, label: t(`photo.pos.${v}`) }))}
                />
              </Field>
              <Field label={`${t('photo.size')} (${watermark.size} %)`}>
                <Slider min={1} max={12} step={0.5} value={watermark.size} label={t('photo.size')} onChange={(size) => setMark({ size })} />
              </Field>
              <Field label={`${t('photo.opacity')} (${Math.round(watermark.opacity * 100)} %)`}>
                <Slider min={0.1} max={1} step={0.05} value={watermark.opacity} label={t('photo.opacity')} onChange={(opacity) => setMark({ opacity })} />
              </Field>
            </>
          )}
          <Field label={t('photo.folder')}>
            <Button
              size="sm"
              icon={<FolderOpen />}
              onClick={async () => {
                const dir = await api.photos.pickFolder()
                if (dir) await settingsActions.update({ lastExportDir: dir })
              }}
            >
              {lastDir ? lastDir.split(/[\\/]/).slice(-2).join('/') : t('photo.chooseFolder')}
            </Button>
          </Field>
          <span className={s.hint}>{t('photo.exportHint')}</span>
        </div>
      )}
    </Dialog>
  )
}
