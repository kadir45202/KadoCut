import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { Button } from './controls'
import s from './ui.module.css'

type Kind = 'info' | 'success' | 'error'

interface Toast {
  id: number
  kind: Kind
  title: string
  text?: string
  action?: { label: string; run(): void }
}

const useToasts = create<{ toasts: Toast[] }>(() => ({ toasts: [] }))
let nextId = 1

function push(kind: Kind, title: string, text?: string, action?: Toast['action']) {
  const id = nextId++
  useToasts.setState((st) => ({ toasts: [...st.toasts.slice(-3), { id, kind, title, text, action }] }))
  setTimeout(() => dismiss(id), kind === 'error' ? 9000 : 4500)
  return id
}

function dismiss(id: number) {
  useToasts.setState((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) }))
}

export const toast = {
  info: (title: string, text?: string, action?: Toast['action']) => push('info', title, text, action),
  success: (title: string, text?: string, action?: Toast['action']) => push('success', title, text, action),
  error: (title: string, text?: string, action?: Toast['action']) => push('error', title, text, action)
}

const ICONS: Record<Kind, ReactNode> = {
  info: <Info color="var(--accent)" />,
  success: <CircleCheck color="var(--success)" />,
  error: <CircleAlert color="var(--danger)" />
}

export function Toasts() {
  const toasts = useToasts((st) => st.toasts)
  return (
    <div className={s.toasts} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={s.toast} role={t.kind === 'error' ? 'alert' : 'status'}>
          {ICONS[t.kind]}
          <div className={s.toastBody}>
            <div className={s.toastTitle}>{t.title}</div>
            {t.text && <div className={s.toastText}>{t.text}</div>}
            {t.action && (
              <div className={s.toastAction}>
                <Button
                  size="sm"
                  onClick={() => {
                    t.action!.run()
                    dismiss(t.id)
                  }}
                >
                  {t.action.label}
                </Button>
              </div>
            )}
          </div>
          <button type="button" className={s.iconButton + ' ' + s.small} aria-label="Close" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  )
}
