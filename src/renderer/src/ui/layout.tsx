import { ChevronDown, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import s from './ui.module.css'

export function Section({ title, children, actions, defaultOpen = true }: { title: ReactNode; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={s.section}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button type="button" className={s.sectionHeader} data-open={open} onClick={() => setOpen(!open)}>
          <ChevronDown />
          {title}
        </button>
        {actions && <div className={s.sectionActions} style={{ paddingRight: 8 }}>{actions}</div>}
      </div>
      {open && <div className={s.sectionBody}>{children}</div>}
    </section>
  )
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <div className={s.fieldControl}>{children}</div>
    </div>
  )
}

export function Progress({ value }: { value: number | null }) {
  return (
    <div className={`${s.progress} ${value === null ? s.progressIndeterminate : ''}`}>
      <div className={s.progressBar} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </div>
  )
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      {icon}
      {title && <div className={s.emptyTitle}>{title}</div>}
      {children}
    </div>
  )
}

export function ErrorCard({ title, message, action }: { title: ReactNode; message: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.errorCard} role="alert">
      <div className={s.errorCardTitle}>
        <TriangleAlert />
        {title}
      </div>
      <div className={s.errorCardText}>{message}</div>
      {action}
    </div>
  )
}

export const spinClass = s.spin
