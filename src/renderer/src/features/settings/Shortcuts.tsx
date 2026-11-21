import { RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { allCommands, useModules } from '@renderer/core/modules/registry'
import { SHORTCUT_PRESETS, comboOf, formatCombo, isModifierOnly } from '@renderer/core/modules/shortcuts'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { useT } from '@renderer/i18n'
import { Button, IconButton, Select } from '@renderer/ui/controls'
import { Field } from '@renderer/ui/layout'
import { toast } from '@renderer/ui/toast'
import s from './settings.module.css'

type Preset = keyof typeof SHORTCUT_PRESETS

/** Every command with its keys; click "Change" and press the new combo. */
export function Shortcuts() {
  const t = useT()
  const records = useModules((st) => st.records)
  const overrides = useSettings((st) => st.settings.shortcuts)
  const [recording, setRecording] = useState<string | null>(null)
  // Defaults straight from the modules (overrides are applied on top).
  const commands = useMemo(
    () =>
      Object.values(records)
        .flatMap((r) => (r.status === 'active' && r.def ? (r.def.commands ?? []) : []))
        .sort((a, b) => a.title().localeCompare(b.title())),
    [records]
  )
  const keysOf = (id: string) => overrides[id] ?? commands.find((c) => c.id === id)?.keys ?? []

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setRecording(null)
      if (isModifierOnly(e.key)) return
      const combo = comboOf(e)
      const next = { ...overrides, [recording]: [combo] }
      // A combo belongs to one command: take it away from any other.
      for (const cmd of allCommands(useModules.getState().records).values()) {
        if (cmd.id !== recording && cmd.keys?.includes(combo)) {
          next[cmd.id] = cmd.keys.filter((k) => k !== combo)
          toast.info(t('shortcuts.moved', { combo: formatCombo(combo), name: cmd.title() }))
        }
      }
      void settingsActions.update({ shortcuts: next })
      setRecording(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, overrides, t])

  const reset = (id: string) => {
    const next = { ...overrides }
    delete next[id]
    void settingsActions.update({ shortcuts: next })
  }

  return (
    <div className={s.group}>
      <Field label={t('shortcuts.preset')}>
        <Select<Preset | 'custom'>
          value={'custom'}
          label={t('shortcuts.preset')}
          onChange={(p) => p !== 'custom' && void settingsActions.update({ shortcuts: { ...SHORTCUT_PRESETS[p] } })}
          options={[
            { value: 'custom', label: t('shortcuts.choose') },
            { value: 'maker', label: 'Maker' },
            { value: 'premiere', label: 'Premiere Pro' },
            { value: 'capcut', label: 'CapCut' }
          ]}
        />
      </Field>
      <div className={s.shortcutList}>
        {commands.map((cmd) => (
          <div key={cmd.id} className={s.shortcutRow}>
            <span className={s.shortcutName}>{cmd.title()}</span>
            <span className={s.shortcutKeys}>
              {recording === cmd.id ? t('shortcuts.press') : keysOf(cmd.id).map(formatCombo).join(' · ') || '—'}
            </span>
            <Button size="sm" onClick={() => setRecording(recording === cmd.id ? null : cmd.id)}>
              {recording === cmd.id ? t('common.cancel') : t('shortcuts.change')}
            </Button>
            <IconButton small label={t('shortcuts.reset')} disabled={!overrides[cmd.id]} onClick={() => reset(cmd.id)}>
              <RotateCcw />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  )
}
