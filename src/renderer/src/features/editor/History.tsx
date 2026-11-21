import { History } from 'lucide-react'
import { useState } from 'react'
import { projectActions, useProject } from '@renderer/core/store/project'
import { useT } from '@renderer/i18n'
import { IconButton } from '@renderer/ui/controls'
import { Popover } from '@renderer/ui/overlays'
import s from './editor.module.css'

/** Undo history: every edit as a step; clicking one returns the project to right after it. */
export function HistoryMenu() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const past = useProject((st) => st.past)
  const future = useProject((st) => st.future)
  const n = past.length
  // Step k = the state after the k-th edit (0 = as opened).
  const rows = [
    ...future.map((e, j) => ({ k: n + j + 1, label: e.label, redo: true })).reverse(),
    ...past.map((e, i) => ({ k: i + 1, label: e.label, redo: false })).reverse(),
    { k: 0, label: t('history.start'), redo: false }
  ]
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      trigger={
        <IconButton label={t('history.title')} disabled={!past.length && !future.length}>
          <History />
        </IconButton>
      }
    >
      <div className={s.history} role="listbox" aria-label={t('history.title')}>
        <span className={s.historyTitle}>{t('history.title')}</span>
        {rows.map((r) => (
          <button
            key={r.k}
            type="button"
            role="option"
            aria-selected={r.k === n}
            className={s.historyRow}
            data-current={r.k === n}
            data-redo={r.redo}
            onClick={() => {
              projectActions.jump(r.k - n)
              setOpen(false)
            }}
          >
            {r.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}
