import { useMemo, useState } from 'react'
import type { AspectPreset } from '@shared/project/schema'
import { importFiles } from '@renderer/core/media/import'
import { runCommand } from '@renderer/core/modules/registry'
import { photoActions, usePhotos, visiblePhotos } from '@renderer/core/store/photos'
import { encodePhoto } from '@renderer/engine/photo/export'
import { useT } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { Button, Segmented, TextInput } from '@renderer/ui/controls'
import { Field, Progress } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import { openProject } from '../app/openProject'
import s from './photos.module.css'

/** Long edge of the photos rendered for video: room for a 4K frame and the slow Ken Burns zoom. */
const VIDEO_EDGE = 2880
const ASPECTS: AspectPreset[] = ['9:16', '4:5', '1:1', '16:9']

/**
 * Renders the chosen photos with their develop settings, starts a new video project with them
 * and opens the slideshow dialog there (music, beat cuts, transitions).
 */
export function PhotoToVideo({ ids, open, onOpenChange }: { ids: string[]; open: boolean; onOpenChange(o: boolean): void }) {
  const t = useT()
  const state = usePhotos()
  const photos = useMemo(() => {
    const set = new Set(ids)
    return visiblePhotos(state).filter((p) => set.has(p.id))
  }, [ids, state.catalog, state.minRating, state.flagFilter, state.sort])
  const [name, setName] = useState('')
  const [aspect, setAspect] = useState<AspectPreset>('9:16')
  const [done, setDone] = useState<number | null>(null)

  const start = async () => {
    setDone(0)
    try {
      const dir = await api.photos.videoDir()
      const files: string[] = []
      for (const [i, p] of photos.entries()) {
        try {
          const data = await encodePhoto(p, { format: 'jpg', quality: 92, longEdge: VIDEO_EDGE })
          // Numbered names keep the library order in the slideshow (it sorts by name).
          files.push(await api.photos.writeExport(dir, `${String(i + 1).padStart(3, '0')}-${p.name.replace(/\.[^.]+$/, '')}.jpg`, data))
        } catch (err) {
          log.warn('photos', `video render failed for ${p.name}: ${String(err)}`)
        }
        setDone(i + 1)
      }
      if (!files.length) throw new Error(t('photo.videoNone'))
      const opened = await api.projects.create({ name: name.trim() || t('photo.videoProject'), aspect, fps: 30 })
      onOpenChange(false)
      await photoActions.close()
      openProject(opened)
      await importFiles(files)
      await runCommand('slideshow.open')
    } catch (err) {
      toast.error(t('photo.videoFailed'), err instanceof Error ? err.message : String(err))
    } finally {
      setDone(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => done === null && onOpenChange(o)}
      title={t('photo.videoTitle', { count: photos.length })}
      description={t('photo.videoText')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={done !== null}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={done !== null || !photos.length} onClick={() => void start()}>
            {t('photo.videoStart')}
          </Button>
        </>
      }
    >
      {done !== null ? (
        <div className={s.exportRun}>
          <span>{t('photo.exporting', { done, total: photos.length })}</span>
          <Progress value={photos.length ? done / photos.length : null} />
        </div>
      ) : (
        <div className={s.exportForm}>
          <Field label={t('photo.videoName')}>
            <TextInput value={name} placeholder={t('photo.videoProject')} aria-label={t('photo.videoName')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label={t('photo.videoAspect')}>
            <Segmented<AspectPreset> value={aspect} onChange={setAspect} options={ASPECTS.map((a) => ({ value: a, label: a }))} />
          </Field>
          <span className={s.hint}>{t('photo.videoHint')}</span>
        </div>
      )}
    </Dialog>
  )
}
