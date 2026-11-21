import { Film } from 'lucide-react'
import { useMemo } from 'react'
import { ModuleBoundary } from '@renderer/core/modules/ModuleBoundary'
import { activeModules, useModules } from '@renderer/core/modules/registry'
import { editorActions, useEditor } from '@renderer/core/store/editor'
import { useT } from '@renderer/i18n'
import { MediaPanel } from './MediaPanel'
import s from './editor.module.css'

/** Left panel: Media plus panels contributed by modules (Audio, Text, Captions, Voice...). */
export function LeftPanel() {
  const t = useT()
  const records = useModules((st) => st.records)
  const active = useEditor((st) => st.leftPanel)
  const panels = useMemo(
    () =>
      activeModules(records)
        .flatMap((m) => (m.panels ?? []).map((p) => ({ ...p, moduleId: m.id })))
        .sort((a, b) => a.order - b.order),
    [records]
  )
  const current = panels.find((p) => p.id === active)

  return (
    <aside className={s.left}>
      <nav className={s.panelTabs}>
        <button type="button" className={s.panelTab} data-active={!current} onClick={() => editorActions.setLeftPanel('media')}>
          <Film />
          <span>{t('media.title')}</span>
        </button>
        {panels.map((p) => (
          <button key={p.id} type="button" className={s.panelTab} data-active={current?.id === p.id} onClick={() => editorActions.setLeftPanel(p.id)}>
            <p.icon />
            <span>{p.title()}</span>
          </button>
        ))}
      </nav>
      <div className={s.panelBody}>
        {current ? (
          <ModuleBoundary key={current.id} moduleId={current.moduleId}>
            <current.Component />
          </ModuleBoundary>
        ) : (
          <MediaPanel />
        )}
      </div>
    </aside>
  )
}
