import { Aperture, Bookmark, ChevronRight, Clapperboard, Copy, Ellipsis, FolderOpen, LayoutTemplate, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OpenedProject } from '@shared/api'
import type { AspectPreset, ProjectSummary } from '@shared/project/schema'
import { useLanguage, useT, type TKey } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { duration, relativeTime } from '@renderer/lib/format'
import { Button, IconButton, Segmented, TextInput } from '@renderer/ui/controls'
import { Empty } from '@renderer/ui/layout'
import { ContextMenu, Dialog, DropdownMenu } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import { photoActions } from '@renderer/core/store/photos'
import { TitleBar } from '../app/TitleBar'
import { SettingsDialog } from '../settings/SettingsDialog'
import { BUILTIN_TEMPLATES, type BuiltinTemplate } from './builtinTemplates'
import s from './home.module.css'

const ASPECTS: { id: AspectPreset; w: number; h: number }[] = [
  { id: '9:16', w: 9, h: 16 },
  { id: '16:9', w: 16, h: 9 },
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 }
]

export function HomeScreen({ onOpen }: { onOpen(p: OpenedProject): void }) {
  const t = useT()
  const lang = useLanguage((st) => st.lang)
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
  const [trashing, setTrashing] = useState<ProjectSummary | null>(null)
  const [templates, setTemplates] = useState<ProjectSummary[]>([])

  const refresh = useCallback(async () => {
    try {
      setProjects(await api.projects.list())
    } catch (err) {
      log.error('home', 'list failed', err)
      setProjects([])
      toast.error(t('home.listFailed'), String(err))
    }
  }, [t])

  useEffect(() => void refresh(), [refresh])
  const refreshTemplates = useCallback(() => void api.templates.list().then(setTemplates).catch(() => setTemplates([])), [])
  useEffect(refreshTemplates, [refreshTemplates])

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      toast.error(t('common.error'), err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const create = (aspect: AspectPreset, name = t('home.untitled'), fps = 30) =>
    run(async () => onOpen(await api.projects.create({ name, aspect, fps })))
  const open = (id: string) => run(async () => onOpen(await api.projects.open(id)))
  const fromBuiltin = (tpl: BuiltinTemplate) =>
    run(async () => {
      const opened = await api.projects.create({ name: t(`tpl.${tpl.id}`), aspect: tpl.aspect, fps: 30 })
      const project = structuredClone(opened.project)
      tpl.fill(project, (key) => t(key as TKey))
      await api.projects.save(project)
      onOpen({ ...opened, project })
    })
  const fromTemplate = (tpl: ProjectSummary) => run(async () => onOpen(await api.templates.create(tpl.id, tpl.name)))

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase(lang)
    return (projects ?? []).filter((p) => !q || p.name.toLocaleLowerCase(lang).includes(q))
  }, [projects, query, lang])

  return (
    <div className={s.screen}>
      <TitleBar
        left={<span className={s.brand}>Maker</span>}
        right={
          <IconButton label={t('settings.title')} onClick={() => setSettingsOpen(true)}>
            <Settings />
          </IconButton>
        }
      />
      <main className={s.content}>
        <section className={s.hero}>
          <div>
            <h1 className={s.title}>{t('home.title')}</h1>
            <p className={s.subtitle}>{t('home.subtitle')}</p>
          </div>
          <Button variant="primary" size="lg" icon={<Plus />} onClick={() => setNewOpen(true)} disabled={busy}>
            {t('home.new')}
          </Button>
        </section>

        <section className={s.quick}>
          {ASPECTS.map((a) => (
            <button key={a.id} type="button" className={s.quickCard} onClick={() => create(a.id)} disabled={busy}>
              <span className={s.quickShape} style={{ aspectRatio: `${a.w} / ${a.h}`, [a.w >= a.h ? 'width' : 'height']: 34 }} />
              <span className={s.quickText}>
                <span className={s.quickTitle}>{t(`aspect.${a.id}.name`)}</span>
                <span className={s.quickSub}>{a.id}</span>
              </span>
            </button>
          ))}
        </section>

        <button type="button" className={s.photoCard} onClick={() => void photoActions.open()} disabled={busy}>
          <span className={s.photoIcon}>
            <Aperture />
          </span>
          <span className={s.quickText}>
            <span className={s.quickTitle}>{t('home.photos')}</span>
            <span className={s.quickSub}>{t('home.photosHint')}</span>
          </span>
          <ChevronRight className={s.photoArrow} />
        </button>

        <section className={s.recentHeader}>
          <h2 className={s.sectionTitle}>{t('home.templates')}</h2>
        </section>
        <section className={s.quick}>
          {BUILTIN_TEMPLATES.map((tpl) => (
            <button key={tpl.id} type="button" className={s.quickCard} onClick={() => fromBuiltin(tpl)} disabled={busy}>
              <LayoutTemplate />
              <span className={s.quickText}>
                <span className={s.quickTitle}>{t(`tpl.${tpl.id}`)}</span>
                <span className={s.quickSub}>{tpl.aspect}</span>
              </span>
            </button>
          ))}
          {templates.map((tpl) => (
            <ContextMenu
              key={tpl.id}
              items={[
                {
                  id: 'delete',
                  label: t('home.templateDelete'),
                  icon: <Trash2 />,
                  danger: true,
                  onSelect: () => run(async () => {
                    await api.templates.remove(tpl.id)
                    refreshTemplates()
                  })
                }
              ]}
            >
              <button type="button" className={s.quickCard} onClick={() => fromTemplate(tpl)} disabled={busy} title={tpl.name}>
                <Bookmark />
                <span className={s.quickText}>
                  <span className={s.quickTitle}>{tpl.name}</span>
                  <span className={s.quickSub}>{tpl.aspect}</span>
                </span>
              </button>
            </ContextMenu>
          ))}
        </section>

        <section className={s.recentHeader}>
          <h2 className={s.sectionTitle}>{t('home.recent')}</h2>
          {projects && projects.length > 0 && (
            <div className={s.search}>
              <Search />
              <TextInput placeholder={t('home.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
        </section>

        {projects === null ? null : filtered.length === 0 ? (
          <Empty icon={<Clapperboard />} title={projects.length ? t('home.noMatch') : t('home.empty')}>
            {!projects.length && t('home.emptyHint')}
          </Empty>
        ) : (
          <div className={s.grid}>
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                lang={lang}
                onOpen={() => open(p.id)}
                onRename={() => setRenaming(p)}
                onDuplicate={() =>
                  run(async () => {
                    await api.projects.duplicate(p.id, t('home.copyName', { name: p.name }))
                    await refresh()
                  })
                }
                onReveal={() => void api.app.revealPath(p.dir)}
                onTrash={() => setTrashing(p)}
              />
            ))}
          </div>
        )}
      </main>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreate={(name, aspect, fps) => create(aspect, name, fps)} />
      <RenameDialog
        project={renaming}
        onClose={() => setRenaming(null)}
        onRename={(name) =>
          run(async () => {
            await api.projects.rename(renaming!.id, name)
            setRenaming(null)
            await refresh()
          })
        }
      />
      <Dialog
        open={!!trashing}
        onOpenChange={(o) => !o && setTrashing(null)}
        title={t('home.trashTitle', { name: trashing?.name ?? '' })}
        description={t('home.trashDesc')}
        footer={
          <>
            <Button onClick={() => setTrashing(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() =>
                run(async () => {
                  await api.projects.trash(trashing!.id)
                  setTrashing(null)
                  await refresh()
                })
              }
            >
              {t('home.trash')}
            </Button>
          </>
        }
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function ProjectCard({
  project: p,
  lang,
  onOpen,
  onRename,
  onDuplicate,
  onReveal,
  onTrash
}: {
  project: ProjectSummary
  lang: string
  onOpen(): void
  onRename(): void
  onDuplicate(): void
  onReveal(): void
  onTrash(): void
}) {
  const t = useT()
  return (
    <div className={s.card} onDoubleClick={onOpen}>
      <button type="button" className={s.thumb} onClick={onOpen} aria-label={p.name}>
        {p.thumbnail ? (
          <img src={p.thumbnail} alt="" style={{ aspectRatio: `${p.width} / ${p.height}` }} />
        ) : (
          <span className={s.thumbEmpty} style={{ aspectRatio: `${p.width} / ${p.height}` }}>
            <Clapperboard />
          </span>
        )}
        {p.duration > 0 && <span className={s.badge}>{duration(p.duration)}</span>}
      </button>
      <div className={s.meta}>
        <div className={s.metaText}>
          <div className={s.name} title={p.name}>
            {p.name}
          </div>
          <div className={s.date}>
            {relativeTime(p.updatedAt, lang)} · {p.aspect}
          </div>
        </div>
        <DropdownMenu
          align="end"
          trigger={
            <button type="button" className={s.more} aria-label={t('common.more')}>
              <Ellipsis />
            </button>
          }
          items={[
            { id: 'open', label: t('home.open'), icon: <FolderOpen />, onSelect: onOpen },
            { id: 'rename', label: t('home.rename'), icon: <Pencil />, onSelect: onRename },
            { id: 'dup', label: t('home.duplicate'), icon: <Copy />, onSelect: onDuplicate },
            { id: 'reveal', label: t('home.reveal'), icon: <FolderOpen />, onSelect: onReveal },
            { id: 'trash', label: t('home.trash'), icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: onTrash }
          ]}
        />
      </div>
    </div>
  )
}

function NewProjectDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange(o: boolean): void; onCreate(name: string, aspect: AspectPreset, fps: number): void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [aspect, setAspect] = useState<AspectPreset>('9:16')
  const [fps, setFps] = useState<'30' | '60' | '24' | '25'>('30')
  const submit = () => {
    onOpenChange(false)
    onCreate(name.trim() || t('home.untitled'), aspect, Number(fps))
    setName('')
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('home.new')}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="primary" onClick={submit}>
            {t('home.create')}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <label className={s.formLabel}>{t('home.name')}</label>
        <TextInput autoFocus value={name} placeholder={t('home.untitled')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <label className={s.formLabel}>{t('home.format')}</label>
        <Segmented<AspectPreset> block value={aspect} onChange={setAspect} options={ASPECTS.map((a) => ({ value: a.id, label: `${a.id} ${t(`aspect.${a.id}.name`)}` }))} />
        <label className={s.formLabel}>{t('home.fps')}</label>
        <Segmented<'24' | '25' | '30' | '60'> block value={fps} onChange={setFps} options={(['24', '25', '30', '60'] as const).map((f) => ({ value: f, label: `${f} fps` }))} />
      </div>
    </Dialog>
  )
}

function RenameDialog({ project, onClose, onRename }: { project: ProjectSummary | null; onClose(): void; onRename(name: string): void }) {
  const t = useT()
  const [name, setName] = useState('')
  useEffect(() => setName(project?.name ?? ''), [project])
  return (
    <Dialog
      open={!!project}
      onOpenChange={(o) => !o && onClose()}
      title={t('home.rename')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={() => onRename(name.trim())}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onRename(name.trim())} />
    </Dialog>
  )
}
