/**
 * User key bindings: settings.shortcuts maps a command id to its key combos and replaces the
 * module's default keys. Presets mirror the editors people come from.
 */

export const SHORTCUT_PRESETS: Record<'maker' | 'premiere' | 'capcut', Record<string, string[]>> = {
  maker: {},
  premiere: {
    'split.split': ['mod+k'],
    'split.trimStart': ['q'],
    'split.trimEnd': ['w'],
    'core.rippleDelete': ['shift+delete', 'alt+backspace'],
    'core.zoomIn': ['='],
    'core.zoomOut': ['-'],
    'core.zoomFit': ['\\'],
    'core.export': ['mod+m'],
    'compound.group': ['mod+g'],
    'compound.ungroup': ['mod+shift+g']
  },
  capcut: {
    'split.split': ['mod+b'],
    'split.trimStart': ['q'],
    'split.trimEnd': ['w'],
    'core.zoomIn': ['mod+='],
    'core.zoomOut': ['mod+-'],
    'core.zoomFit': ['shift+z'],
    'core.export': ['mod+e'],
    'compound.group': ['mod+g'],
    'compound.ungroup': ['mod+shift+g']
  }
}

const KEY_NAMES: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  space: 'Space',
  delete: 'Delete',
  backspace: 'Backspace',
  arrowleft: '←',
  arrowright: '→',
  arrowup: '↑',
  arrowdown: '↓',
  home: 'Home',
  end: 'End',
  escape: 'Esc',
  enter: 'Enter'
}

/** 'mod+shift+g' → 'Ctrl+Shift+G' */
export const formatCombo = (combo: string) =>
  combo
    .split('+')
    .map((part) => KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
    .join('+')

/** Key combo of a keyboard event, in the same form commands declare ('mod+shift+g'). */
export function comboOf(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key'>): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  let key = e.key.toLowerCase()
  if (key === ' ') key = 'space'
  if (key === '+') key = '='
  parts.push(key)
  return parts.join('+')
}

export const isModifierOnly = (key: string) => ['control', 'shift', 'alt', 'meta'].includes(key.toLowerCase())
