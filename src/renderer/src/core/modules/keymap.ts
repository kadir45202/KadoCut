import { allCommands, commandEnabled, runCommand, useModules } from './registry'
import { comboOf } from './shortcuts'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'
}

/** Global shortcuts: dispatches key combos to module commands. */
export function installKeymap(): () => void {
  const onKey = (e: KeyboardEvent) => {
    // Key repeat only makes sense for frame stepping.
    if (isTyping(e.target) || (e.repeat && !['arrowleft', 'arrowright'].includes(e.key.toLowerCase()))) return
    const combo = comboOf(e)
    for (const cmd of allCommands(useModules.getState().records).values()) {
      if (!cmd.keys?.includes(combo)) continue
      if (!commandEnabled(cmd)) continue
      e.preventDefault()
      void runCommand(cmd.id)
      return
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
