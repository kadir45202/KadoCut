import type { ReactNode } from 'react'
import s from './titlebar.module.css'

/** Custom title bar; the native window controls are drawn by Windows on the right. */
export function TitleBar({ left, center, right }: { left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  return (
    <header className={`${s.bar} drag`}>
      <div className={`${s.side} no-drag`}>{left}</div>
      <div className={s.center}>{center}</div>
      <div className={`${s.side} ${s.right} no-drag`}>{right}</div>
    </header>
  )
}
