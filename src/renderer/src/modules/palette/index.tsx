import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { defineModule } from '@renderer/core/modules/types'
import { activeModules, allCommands, commandEnabled, runCommand, useModules } from '@renderer/core/modules/registry'
import { editorActions } from '@renderer/core/store/editor'
import { useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, translate, useStrings } from '@renderer/i18n'
import { Dialog } from '@renderer/ui/overlays'
import s from './palette.module.css'

const strings = defineStrings({
  tr: {
    name: 'Komut paleti',
    desc: 'Tüm komutları ve panelleri adıyla arayıp çalıştırır (Ctrl+Shift+P veya F1).',
    open: 'Komut paleti',
    search: 'Komut veya panel ara…',
    panel: 'Panel: {name}',
    empty: 'Eşleşen komut yok',
    hint: '↑↓ seç · Enter çalıştır · Esc kapat'
  },
  en: {
    name: 'Command palette',
    desc: 'Find and run any command or panel by name (Ctrl+Shift+P or F1).',
    open: 'Command palette',
    search: 'Search commands and panels…',
    panel: 'Panel: {name}',
    empty: 'No matching command',
    hint: '↑↓ select · Enter run · Esc close'
  }
})
const tt = stringsT(strings)
const ID = 'palette'

const usePalette = create<{ open: boolean }>(() => ({ open: false }))

interface Entry {
  id: string
  title: string
  keys?: string
  enabled: boolean
  run(): void
}

/** Every word of the query must appear in the title (case- and Turkish-i-insensitive). */
function matches(title: string, query: string): boolean {
  const hay = title.toLocaleLowerCase()
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

function PaletteDialog() {
  const t = useStrings(strings)
  const open = usePalette((st) => st.open)
  const records = useModules((st) => st.records)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const entries = useMemo<Entry[]>(() => {
    if (!open) return []
    const commands = [...allCommands(records).values()]
      .filter((c) => c.id !== 'palette.open')
      .map((c) => ({ id: c.id, title: c.title(), keys: c.keyLabel, enabled: commandEnabled(c), run: () => void runCommand(c.id) }))
    const panels = [{ id: 'media', title: translate('media.title') }, ...activeModules(records).flatMap((m) => (m.panels ?? []).map((p) => ({ id: p.id, title: p.title() })))].map((p) => ({
      id: `panel:${p.id}`,
      title: t('panel', { name: p.title }),
      enabled: true,
      run: () => editorActions.setLeftPanel(p.id)
    }))
    // Same title from several modules (e.g. "Play") shows once.
    const seen = new Set<string>()
    return [...commands, ...panels].filter((e) => !seen.has(e.title) && seen.add(e.title))
  }, [open, records, t])

  const shown = entries.filter((e) => matches(e.title, query)).sort((a, b) => Number(b.enabled) - Number(a.enabled))

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
    }
  }, [open])
  useEffect(() => setIndex(0), [query])
  useEffect(() => list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }), [index])

  const close = () => usePalette.setState({ open: false })
  const run = (e: Entry | undefined) => {
    if (!e?.enabled) return
    close()
    // Let the dialog close (and focus return) before the command runs.
    requestAnimationFrame(() => e.run())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => usePalette.setState({ open: o })} title={t('open')}>
      <div className={s.palette}>
        <input
          className={s.input}
          autoFocus
          value={query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(shown.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(shown[index])
            }
          }}
        />
        <div className={s.list} ref={list} role="listbox" aria-label={t('open')}>
          {shown.length === 0 && <div className={s.empty}>{t('empty')}</div>}
          {shown.map((e, i) => (
            <button
              key={e.id}
              type="button"
              role="option"
              aria-selected={i === index}
              data-active={i === index}
              disabled={!e.enabled}
              className={s.item}
              onMouseEnter={() => setIndex(i)}
              onClick={() => run(e)}
            >
              <span>{e.title}</span>
              {e.keys && <kbd className={s.keys}>{e.keys}</kbd>}
            </button>
          ))}
        </div>
        <div className={s.hint}>{t('hint')}</div>
      </div>
    </Dialog>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    {
      id: 'palette.open',
      title: () => tt('open'),
      keys: ['mod+shift+p', 'f1'],
      keyLabel: 'Ctrl+Shift+P',
      enabled: () => !!useProject.getState().project,
      run: () => usePalette.setState({ open: true })
    }
  ],
  dialogs: [{ id: 'palette', Component: PaletteDialog }]
})
