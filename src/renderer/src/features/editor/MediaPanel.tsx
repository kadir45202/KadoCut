import { AudioLines, Eraser, FolderInput, FolderOpen, FolderSearch, ImageIcon, Images, Link, MoreHorizontal, Plus, Search, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Asset } from '@shared/project/schema'
import { addAssetToTimeline, importFiles } from '@renderer/core/media/import'
import { activeModules, findCommand, reportModuleError, runCommand, useModules } from '@renderer/core/modules/registry'
import { analyzeAsset, useMedia } from '@renderer/core/media/media'
import { collectMedia, externalAssets, relinkFromFolder, removeUnused, usedAssetIds } from '@renderer/core/media/manage'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useT } from '@renderer/i18n'
import { api, mediaUrl, pathForFile } from '@renderer/lib/api'
import { shortDuration } from '@renderer/lib/format'
import { Button, IconButton, Segmented, TextInput } from '@renderer/ui/controls'
import { Empty } from '@renderer/ui/layout'
import { ContextMenu, DropdownMenu } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import s from './editor.module.css'

export const ASSET_MIME = 'application/x-maker-asset'
/** Drag payload carrying an absolute file path (e.g. built-in sound effects). */
export const FILE_MIME = 'application/x-maker-file'

export function MediaPanel() {
  const t = useT()
  const assets = useProject((st) => st.project!.assets)
  const missing = useProject((st) => st.missing)
  const [dragOver, setDragOver] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'video' | 'audio' | 'image'>('all')
  const all = Object.values(assets).filter((a) => !a.hidden)
  const q = query.trim().toLocaleLowerCase()
  const visible = all.filter((a) => (kind === 'all' || a.kind === kind) && (!q || a.name.toLocaleLowerCase().includes(q)))
  const dir = useProject((st) => st.dir)
  const project = useProject((st) => st.project!)
  const unusedCount = useMemo(() => {
    const used = usedAssetIds(project)
    return Object.keys(project.assets).filter((id) => !used.has(id)).length
  }, [project])
  const externalCount = useMemo(() => externalAssets(project, dir, missing).length, [project, dir, missing])

  const pick = async () => {
    const paths = await api.media.pickFiles('media')
    await importFiles(paths)
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const paths = [...e.dataTransfer.files].map(pathForFile).filter(Boolean)
    await importFiles(paths)
  }

  return (
    <div
      className={s.media}
      data-drag={dragOver}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className={s.mediaHeader}>
        <Button size="sm" variant="primary" icon={<Upload />} onClick={pick}>
          {t('media.importButton')}
        </Button>
        <DropdownMenu
          align="end"
          trigger={
            <IconButton label={t('media.more')} small>
              <MoreHorizontal />
            </IconButton>
          }
          items={[
            // Tools from modules, reached through their commands.
            ...(findCommand('slideshow.open')
              ? [{ id: 'slideshow', label: findCommand('slideshow.open')!.title(), icon: <Images />, onSelect: () => void runCommand('slideshow.open') }]
              : []),
            { id: 'find', label: t('media.findInFolder'), icon: <FolderSearch />, disabled: !missing.length, onSelect: () => void relinkFromFolder() },
            { id: 'collect', label: `${t('media.collect')}${externalCount ? ` (${externalCount})` : ''}`, icon: <FolderInput />, disabled: !externalCount, onSelect: () => void collectMedia() },
            {
              id: 'unused',
              label: `${t('media.removeUnused')}${unusedCount ? ` (${unusedCount})` : ''}`,
              icon: <Eraser />,
              disabled: !unusedCount,
              separatorBefore: true,
              onSelect: () => {
                const n = removeUnused()
                toast.success(n ? t('media.removedUnused', { count: n }) : t('media.nothingUnused'))
              }
            }
          ]}
        />
      </div>
      {missing.length > 0 && (
        <div className={s.missingBanner}>
          <TriangleAlert />
          <span>{t('media.missingBanner', { count: missing.length })}</span>
          <Button size="sm" variant="ghost" onClick={() => void relinkFromFolder()}>
            {t('media.findInFolder')}
          </Button>
        </div>
      )}
      {all.length > 4 && (
        <div className={s.mediaFilter}>
          <div className={s.mediaSearch}>
            <Search />
            <TextInput value={query} placeholder={t('media.search')} aria-label={t('media.search')} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <Segmented<typeof kind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: t('media.all') },
              { value: 'video', label: t('media.kind.video') },
              { value: 'audio', label: t('media.kind.audio') },
              { value: 'image', label: t('media.kind.image') }
            ]}
          />
        </div>
      )}
      {all.length === 0 ? (
        <Empty icon={<Upload />} title={t('media.emptyTitle')}>
          {t('media.emptyHint')}
        </Empty>
      ) : visible.length === 0 ? (
        <Empty icon={<Search />} title={t('media.noMatch')} />
      ) : (
        <div className={s.mediaGrid}>
          {visible.map((a) => (
            <AssetTile key={a.id} asset={a} missing={missing.includes(a.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function AssetTile({ asset, missing }: { asset: Asset; missing: boolean }) {
  const t = useT()
  const strip = useMedia((st) => st.filmstrip[asset.path]?.data)
  const used = useProject((st) =>
    Object.values(st.project!.clips).some((c) => 'assetId' in c && c.assetId === asset.id)
  )

  const relink = async () => {
    const path = await api.media.pickFile(asset.kind === 'audio' ? 'audio' : 'media')
    if (!path) return
    const [probe] = await api.media.probe([path])
    if (!probe?.ok || probe.asset.kind !== asset.kind) {
      toast.error(t('media.relinkMismatch'))
      return
    }
    const ok = projectActions.apply(t('media.relink'), (d) => {
      const a = d.assets[asset.id]
      Object.assign(a, { ...probe.asset, id: a.id, name: a.name, hidden: a.hidden, derived: a.derived, beats: a.beats, transcript: a.transcript })
    })
    if (ok) {
      projectActions.setMissing(useProject.getState().missing.filter((id) => id !== asset.id))
      analyzeAsset({ ...asset, path })
    }
  }

  const records = useModules((st) => st.records)
  const moduleItems = useMemo(
    () =>
      activeModules(records)
        .flatMap((m) => (m.assetMenu ?? []).map((item) => ({ item, moduleId: m.id })))
        .filter(({ item }) => {
          try {
            return item.when(asset)
          } catch {
            return false
          }
        })
        .sort((a, b) => a.item.order - b.item.order)
        .map(({ item, moduleId }, i) => ({
          id: `${moduleId}:${item.id}`,
          label: item.title(),
          icon: item.icon ? <item.icon /> : undefined,
          disabled: missing,
          separatorBefore: i === 0,
          onSelect: () => {
            Promise.resolve()
              .then(() => item.run(asset))
              .catch((err) => reportModuleError(moduleId, err))
          }
        })),
    [records, asset, missing]
  )

  const remove = () =>
    projectActions.apply(t('media.remove'), (d) => {
      delete d.assets[asset.id]
    })

  return (
    <ContextMenu
      items={[
        { id: 'add', label: t('media.addToTimeline'), icon: <Plus />, disabled: missing, onSelect: () => addAssetToTimeline(asset) },
        ...(asset.kind !== 'audio'
          ? [{ id: 'overlay', label: t('media.addAsOverlay'), icon: <Plus />, disabled: missing, onSelect: () => addAssetToTimeline(asset, { overlay: true }) }]
          : []),
        { id: 'reveal', label: t('home.reveal'), icon: <FolderOpen />, disabled: missing, onSelect: () => void api.app.revealPath(asset.path) },
        { id: 'relink', label: t('media.relink'), icon: <Link />, onSelect: relink },
        ...moduleItems,
        { id: 'remove', label: used ? t('media.removeUsed') : t('media.remove'), icon: <Trash2 />, danger: true, disabled: used, separatorBefore: true, onSelect: remove }
      ]}
    >
      <div
        className={s.asset}
        data-missing={missing}
        draggable={!missing}
        onDragStart={(e) => {
          e.dataTransfer.setData(ASSET_MIME, asset.id)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onDoubleClick={() => (missing ? relink() : addAssetToTimeline(asset))}
        title={asset.name}
      >
        <div className={s.assetThumb}>
          {missing ? (
            <TriangleAlert color="var(--danger)" />
          ) : asset.kind === 'image' ? (
            <img src={mediaUrl(asset.path)} alt="" loading="lazy" />
          ) : asset.kind === 'video' && strip ? (
            <span
              className={s.assetStrip}
              style={{
                backgroundImage: `url("${strip.url}")`,
                backgroundSize: `${strip.count * 100}% 100%`,
                aspectRatio: `${strip.tileWidth} / ${strip.tileHeight}`
              }}
            />
          ) : asset.kind === 'audio' ? (
            <AudioLines />
          ) : (
            <ImageIcon />
          )}
          {asset.duration > 0 && <span className={s.assetDuration}>{shortDuration(asset.duration)}</span>}
        </div>
        <div className={s.assetName}>{asset.name}</div>
      </div>
    </ContextMenu>
  )
}
