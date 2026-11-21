import { useEffect, useMemo, useState } from 'react'
import { ClipboardPaste, Clapperboard, Copy, ImagePlus, RotateCcw, SlidersHorizontal, Trash2 } from 'lucide-react'
import { photoActions, usePhotos, visiblePhotos, type FlagFilter, type PhotoSort } from '@renderer/core/store/photos'
import { requestThumb, useThumbs } from '@renderer/engine/photo/images'
import { BUILTIN_PRESETS } from '@renderer/engine/photo/presets'
import { useT } from '@renderer/i18n'
import { pathForFile } from '@renderer/lib/api'
import { Button, Select, Slider } from '@renderer/ui/controls'
import { Empty } from '@renderer/ui/layout'
import { PhotoToVideo } from './PhotoToVideo'
import { FlagIcon, Stars } from './Stars'
import s from './photos.module.css'

export function Library() {
  const t = useT()
  const state = usePhotos()
  const { catalog, selection, minRating, flagFilter, sort, importing, clipboard } = state
  const list = useMemo(() => visiblePhotos(state), [catalog, minRating, flagFilter, sort])
  const urls = useThumbs((st) => st.urls)
  const [size, setSize] = useState(180)
  const [dragOver, setDragOver] = useState(false)
  const [toVideo, setToVideo] = useState<string[] | null>(null)
  const selected = new Set(selection)

  useEffect(() => list.forEach(requestThumb), [list])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    void photoActions.import([...e.dataTransfer.files].map(pathForFile).filter(Boolean))
  }
  const onClick = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && selection.length) {
      // Range from the last selected photo.
      const ids = list.map((p) => p.id)
      const a = ids.indexOf(selection[selection.length - 1])
      const b = ids.indexOf(id)
      photoActions.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1))
    } else photoActions.select([id], e.ctrlKey || e.metaKey)
  }
  const targets = selection.length ? selection : []
  const first = catalog?.photos.find((p) => p.id === selection[0])

  return (
    <div className={s.libraryLayout}>
      <aside className={s.sidebar}>
        <Button variant="primary" icon={<ImagePlus />} disabled={importing} onClick={() => void photoActions.import()}>
          {importing ? t('photo.importing') : t('photo.import')}
        </Button>
        <span className={s.sideTitle}>{t('photo.filter')}</span>
        <Select<FlagFilter>
          value={flagFilter}
          label={t('photo.flagFilter')}
          onChange={(v) => photoActions.setFilter({ flagFilter: v })}
          options={[
            { value: 'all', label: t('photo.flag.all') },
            { value: 'pick', label: t('photo.flag.pick') },
            { value: 'unflagged', label: t('photo.flag.none') },
            { value: 'reject', label: t('photo.flag.reject') }
          ]}
        />
        <div className={s.filterStars}>
          <span>{t('photo.minRating')}</span>
          <Stars value={minRating} onChange={(v) => photoActions.setFilter({ minRating: v })} small />
        </div>
        <span className={s.sideTitle}>{t('photo.sort')}</span>
        <Select<PhotoSort>
          value={sort}
          label={t('photo.sort')}
          onChange={(v) => photoActions.setFilter({ sort: v })}
          options={[
            { value: 'added', label: t('photo.sort.added') },
            { value: 'name', label: t('photo.sort.name') },
            { value: 'rating', label: t('photo.sort.rating') }
          ]}
        />
        <span className={s.hint}>{t('photo.count', { shown: list.length, total: catalog?.photos.length ?? 0 })}</span>
        <span className={s.sideTitle}>{t('photo.thumbSize')}</span>
        <div>
          <Slider min={110} max={320} step={10} value={size} label={t('photo.thumbSize')} onChange={setSize} />
        </div>
        <span className={s.hint}>{t('photo.libraryHint')}</span>
      </aside>

      <div
        className={s.gridArea}
        data-drag={dragOver}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={(e) => e.target === e.currentTarget && photoActions.select([])}
      >
        {!catalog?.photos.length ? (
          <Empty icon={<ImagePlus />} title={t('photo.emptyTitle')}>
            {t('photo.emptyHint')}
          </Empty>
        ) : (
          <div className={s.grid} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
            {list.map((p) => (
              <div
                key={p.id}
                className={s.card}
                data-selected={selected.has(p.id)}
                data-testid="photo-card"
                title={p.name}
                onClick={(e) => onClick(p.id, e)}
                onDoubleClick={() => {
                  usePhotos.setState({ currentId: p.id, selection: [p.id] })
                  photoActions.setView('develop')
                }}
              >
                <div className={s.cardThumb} style={{ height: size * 0.75 }}>
                  {urls[p.id] ? <img src={urls[p.id]} alt="" draggable={false} /> : <span className={s.thumbEmpty} />}
                  <span className={s.cardFlag}>
                    <FlagIcon flag={p.flag} />
                  </span>
                </div>
                <div className={s.cardFoot}>
                  <span className={s.cardName}>{p.name}</span>
                  <Stars value={p.rating} onChange={(v) => photoActions.setRating([p.id], v)} small />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className={s.sidebar}>
        {first ? (
          <>
            <span className={s.sideTitle}>{selection.length > 1 ? t('photo.selected', { count: selection.length }) : first.name}</span>
            {selection.length === 1 && (
              <span className={s.hint}>
                {first.width}×{first.height}
                <br />
                {first.path}
              </span>
            )}
            <Button
              icon={<SlidersHorizontal />}
              onClick={() => {
                usePhotos.setState({ currentId: first.id })
                photoActions.setView('develop')
              }}
            >
              {t('photo.toDevelop')}
            </Button>
            <Button icon={<Clapperboard />} onClick={() => setToVideo(targets)}>
              {t('photo.toVideo')}
            </Button>
            <span className={s.sideTitle}>{t('photo.quickPreset')}</span>
            <Select<string>
              value="none"
              label={t('photo.quickPreset')}
              onChange={(id) => {
                const p = BUILTIN_PRESETS.find((x) => x.id === id) ?? catalog?.presets.find((x) => x.id === id)
                if (p) photoActions.applyPreset(targets, p.develop)
              }}
              options={[
                { value: 'none', label: t('photo.choosePreset') },
                ...BUILTIN_PRESETS.map((p) => ({ value: p.id, label: t(`photo.preset.${p.id}`) })),
                ...(catalog?.presets ?? []).map((p) => ({ value: p.id, label: p.name }))
              ]}
            />
            <Button size="sm" icon={<Copy />} disabled={selection.length !== 1} onClick={() => photoActions.copySettings(first.id)}>
              {t('photo.copySettings')}
            </Button>
            <Button size="sm" icon={<ClipboardPaste />} disabled={!clipboard} onClick={() => photoActions.pasteSettings(targets)}>
              {t('photo.pasteSettings', { count: targets.length })}
            </Button>
            <Button size="sm" icon={<RotateCcw />} onClick={() => photoActions.reset(targets, true)}>
              {t('photo.resetAll')}
            </Button>
            <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => photoActions.remove(targets)}>
              {t('photo.remove', { count: targets.length })}
            </Button>
            <span className={s.hint}>{t('photo.removeHint')}</span>
          </>
        ) : (
          <span className={s.hint}>{t('photo.selectHint')}</span>
        )}
      </aside>
      <PhotoToVideo ids={toVideo ?? []} open={!!toVideo} onOpenChange={(o) => !o && setToVideo(null)} />
    </div>
  )
}
