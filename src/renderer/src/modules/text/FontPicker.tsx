import { ChevronDown, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { BUNDLED_FONTS, fontActions, fontLabel, useFonts } from '@renderer/core/fonts/fonts'
import { useStrings } from '@renderer/i18n'
import { Popover } from '@renderer/ui/overlays'
import { toast } from '@renderer/ui/toast'
import { strings } from './strings'
import s from './text.module.css'

interface Item {
  family: string
  label: string
  path?: string
}

/** Searchable font list with previews: Maker fonts, fonts the user added, installed fonts. */
export function FontPicker({ value, onChange }: { value: string; onChange(family: string): void }) {
  const t = useStrings(strings)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const system = useFonts((st) => st.system)
  const custom = useFonts((st) => st.custom)

  const groups = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    const match = (i: Item) => !q || i.label.toLocaleLowerCase().includes(q)
    const bundled = new Set(BUNDLED_FONTS.map((f) => f.family))
    return [
      { title: t('fontsMaker'), items: BUNDLED_FONTS.filter(match) },
      { title: t('fontsAdded'), items: custom.map((f) => ({ family: f.family, label: f.family, path: f.path })).filter(match) },
      { title: t('fontsSystem'), items: system.filter((f) => !bundled.has(f)).map((f) => ({ family: f, label: f })).filter(match) }
    ].filter((g) => g.items.length)
  }, [query, system, custom, t])

  const pick = (family: string) => {
    onChange(family)
    setOpen(false)
  }

  const add = async () => {
    try {
      const added = await fontActions.import()
      if (added.length) {
        toast.success(t('fontAdded', { count: added.length }))
        pick(added[0].family)
      }
    } catch (err) {
      toast.error(t('fontAddFailed'), err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        // Reading installed fonts needs a user gesture; opening the list is one.
        if (o) void fontActions.loadSystem()
      }}
      align="start"
      trigger={
        <button type="button" className={s.fontButton} style={{ fontFamily: `"${value}", sans-serif` }} aria-label={t('font')}>
          <span>{fontLabel(value)}</span>
          <ChevronDown />
        </button>
      }
    >
      <div className={s.fontPicker}>
        <label className={s.fontSearch}>
          <Search />
          <input autoFocus value={query} placeholder={t('fontSearch')} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className={s.fontList} role="listbox">
          {groups.map((g) => (
            <div key={g.title}>
              <div className={s.fontGroup}>{g.title}</div>
              {g.items.map((f: Item) => (
                <div key={f.family} className={s.fontRow} data-active={f.family === value} role="option" aria-selected={f.family === value} onClick={() => pick(f.family)}>
                  <span style={{ fontFamily: `"${f.family}", sans-serif` }}>{f.label}</span>
                  {f.path && (
                    <button
                      type="button"
                      className={s.fontRemove}
                      aria-label={t('fontRemove')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void fontActions.remove(f.path!)
                      }}
                    >
                      <Trash2 />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
          {!groups.length && <div className={s.fontEmpty}>{t('fontNone')}</div>}
        </div>
        <button type="button" className={s.fontAdd} onClick={add}>
          <Plus />
          {t('fontAdd')}
        </button>
      </div>
    </Popover>
  )
}
