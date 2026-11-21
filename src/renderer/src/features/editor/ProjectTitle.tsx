import { useState } from 'react'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useT } from '@renderer/i18n'
import s from './editor.module.css'

/** Project name (click to rename) with save status. */
export function ProjectTitle() {
  const t = useT()
  const name = useProject((st) => st.project!.name)
  const saving = useProject((st) => st.saving)
  const saveError = useProject((st) => st.saveError)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== name) projectActions.apply(t('project.rename'), (d) => void (d.name = next.slice(0, 200)))
  }

  return (
    <div className={s.title}>
      {editing ? (
        <input
          autoFocus
          className={s.titleInput}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <button
          type="button"
          className={s.titleButton}
          onClick={() => {
            setDraft(name)
            setEditing(true)
          }}
        >
          {name}
        </button>
      )}
      <span className={s.saveState} data-error={!!saveError}>
        {saveError ? t('save.error') : saving ? t('save.saving') : t('save.saved')}
      </span>
    </div>
  )
}
