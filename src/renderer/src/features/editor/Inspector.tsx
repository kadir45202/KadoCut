import { Bookmark, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Clip, Project } from '@shared/project/schema'
import { ModuleBoundary } from '@renderer/core/modules/ModuleBoundary'
import { activeModules, useModules } from '@renderer/core/modules/registry'
import type { InspectorTab } from '@renderer/core/modules/types'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useT, type TKey } from '@renderer/i18n'
import { ColorInput, IconButton, Select, Switch, TextInput } from '@renderer/ui/controls'
import { FRAME_RATES, SIZE_TIERS, setFrameRate, shortSide, sizeFor } from '@renderer/core/project/canvas'
import { api } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { Empty, Field, Section } from '@renderer/ui/layout'
import s from './editor.module.css'

const TABS: { id: InspectorTab; label: TKey }[] = [
  { id: 'video', label: 'inspector.video' },
  { id: 'text', label: 'inspector.text' },
  { id: 'audio', label: 'inspector.audio' },
  { id: 'speed', label: 'inspector.speed' }
]

function safeWhen(fn: (c: Clip, p: Project) => boolean, clip: Clip, project: Project) {
  try {
    return fn(clip, project)
  } catch {
    return false
  }
}

export function Inspector() {
  const t = useT()
  const records = useModules((st) => st.records)
  const selection = useEditor((st) => st.selection)
  const tab = useEditor((st) => st.inspectorTab)
  const project = useProject((st) => st.project!)
  const clip = selection.length === 1 ? project.clips[selection[0]] : undefined

  const sections = useMemo(
    () =>
      activeModules(records)
        .flatMap((m) => (m.inspector ?? []).map((sec) => ({ ...sec, moduleId: m.id })))
        .sort((a, b) => a.order - b.order),
    [records]
  )

  if (!clip) {
    return (
      <aside className={s.inspector}>
        {selection.length > 1 ? (
          <Empty icon={<SlidersHorizontal />} title={t('inspector.multi', { count: selection.length })} />
        ) : (
          <ProjectInspector />
        )}
      </aside>
    )
  }

  const available = sections.filter((sec) => safeWhen(sec.when, clip, project))
  const tabs = TABS.filter((tb) => available.some((sec) => sec.tab === tb.id))
  const current = tabs.find((tb) => tb.id === tab) ?? tabs[0]

  return (
    <aside className={s.inspector}>
      {tabs.length > 1 && (
        <nav className={s.inspectorTabs}>
          {tabs.map((tb) => (
            <button key={tb.id} type="button" className={s.inspectorTab} data-active={tb.id === current?.id} onClick={() => editorActions.setInspectorTab(tb.id)}>
              {t(tb.label)}
            </button>
          ))}
        </nav>
      )}
      <div className={s.inspectorBody}>
        {current ? (
          available
            .filter((sec) => sec.tab === current.id)
            .map((sec) => (
              <ModuleBoundary key={`${sec.id}:${clip.id}`} moduleId={sec.moduleId}>
                <sec.Component clip={clip} />
              </ModuleBoundary>
            ))
        ) : (
          <Empty icon={<SlidersHorizontal />} title={t('inspector.nothing')} />
        )}
      </div>
    </aside>
  )
}

function SaveTemplate() {
  const t = useT()
  const [name, setName] = useState('')
  const save = async () => {
    const project = useProject.getState().project!
    const label = name.trim() || project.name
    try {
      await projectActions.flush()
      await api.templates.saveFrom(project.id, label)
      setName('')
      toast.success(t('project.templateSaved', { name: label }))
    } catch (err) {
      toast.error(t('common.error'), err instanceof Error ? err.message : String(err))
    }
  }
  return (
    <Field label={t('home.templates')}>
      <TextInput value={name} placeholder={t('project.templateName')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <IconButton label={t('project.saveTemplate')} onClick={() => void save()}>
        <Bookmark />
      </IconButton>
    </Field>
  )
}

/** Shown when nothing is selected: canvas settings. */
function ProjectInspector() {
  const t = useT()
  const settings = useProject((st) => st.project!.settings)
  return (
    <div className={s.inspectorBody}>
      <Section title={t('inspector.project')}>
        <Field label={t('inspector.resolution')}>
          <Select<string>
            value={String(shortSide(settings))}
            label={t('inspector.resolution')}
            onChange={(v) =>
              projectActions.apply(t('inspector.resolution'), (d) => void Object.assign(d.settings, sizeFor(d.settings.aspect, Number(v))))
            }
            options={[
              // A size from an older version that is not one of the tiers stays selectable.
              ...(SIZE_TIERS.some((tier) => tier.short === shortSide(settings)) ? [] : [{ short: shortSide(settings), label: '' }]),
              ...SIZE_TIERS
            ].map((tier) => {
              const size = tier.label ? sizeFor(settings.aspect, tier.short) : settings
              return { value: String(tier.short), label: `${tier.label ? `${tier.label} · ` : ''}${size.width}×${size.height}` }
            })}
          />
        </Field>
        <Field label={t('inspector.fps')}>
          <Select<string>
            value={String(settings.fps)}
            label={t('inspector.fps')}
            onChange={(v) => projectActions.apply(t('inspector.fps'), (d) => setFrameRate(d as Project, Number(v)))}
            options={[...new Set([...FRAME_RATES, settings.fps])].sort((a, b) => a - b).map((f) => ({ value: String(f), label: `${f} fps` }))}
          />
        </Field>
        <Field label={t('inspector.background')}>
          <ColorInput
            value={settings.background}
            label={t('inspector.background')}
            onChange={(v) => projectActions.apply(t('inspector.background'), (d) => void (d.settings.background = v))}
          />
        </Field>
        <SaveTemplate />
        <Field label={t('inspector.magnetic')}>
          <Switch
            checked={settings.magnetic}
            label={t('inspector.magnetic')}
            onChange={(v) => projectActions.apply(t('inspector.magnetic'), (d) => void (d.settings.magnetic = v))}
          />
        </Field>
      </Section>
    </div>
  )
}
