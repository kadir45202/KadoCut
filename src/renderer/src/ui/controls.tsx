import { Select as RSelect } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import s from './ui.module.css'
import { Tooltip } from './overlays'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, icon, className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx(
        s.button,
        variant === 'primary' && s.primary,
        variant === 'ghost' && s.ghost,
        variant === 'danger' && s.danger,
        size === 'sm' && s.sm,
        size === 'lg' && s.lg,
        block && s.block,
        className
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  keys?: string
  active?: boolean
  small?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, keys, active, small, className, children, ...rest },
  ref
) {
  return (
    <Tooltip content={label} keys={keys}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cx(s.iconButton, active && s.active, small && s.small, className)}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  )
})

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange(v: boolean): void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-on={checked}
      disabled={disabled}
      className={s.switch}
      onClick={() => onChange(!checked)}
    />
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label?: string
  icon?: ReactNode
  title?: string
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  block
}: {
  value: T
  options: SegmentOption<T>[]
  onChange(v: T): void
  block?: boolean
}) {
  return (
    <div className={cx(s.segmented, block && s.segmentedBlock)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          data-active={o.value === value}
          className={s.segment}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref
) {
  return <input ref={ref} className={cx(s.input, className)} spellCheck={false} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref
) {
  return <textarea ref={ref} className={cx(s.textarea, className)} {...rest} />
})

export function ColorInput({ value, onChange, label }: { value: string; onChange(v: string): void; label?: string }) {
  return (
    <span className={s.color} style={{ background: value }} title={label}>
      <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </span>
  )
}

export interface GestureHandlers {
  /** Called once when a drag gesture starts (open an undo group). */
  onStart?(): void
  onChange(v: number): void
  /** Called when the drag gesture ends (close the undo group). */
  onEnd?(): void
}

interface ScrubProps extends GestureHandlers {
  value: number
  min?: number
  max?: number
  step?: number
  /** Value change per pixel dragged (defaults to step). */
  sensitivity?: number
  precision?: number
  unit?: string
  format?(v: number): string
  parse?(text: string): number
  disabled?: boolean
  label?: string
}

const clamp = (v: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))

/**
 * Number field that is changed by dragging horizontally (Shift = fine), or by clicking and
 * typing — the interaction pro editors use for inspector values.
 */
export function ScrubNumber({ value, min, max, step = 1, sensitivity, precision = 0, unit, format, parse, disabled, label, onStart, onChange, onEnd }: ScrubProps) {
  const [editing, setEditing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [draft, setDraft] = useState('')
  const drag = useRef<{ startX: number; startValue: number; moved: boolean; pointerId: number } | null>(null)
  const display = format ? format(value) : value.toFixed(precision)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || editing || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startValue: value, moved: false, pointerId: e.pointerId }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    if (!d.moved && Math.abs(dx) < 3) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
      onStart?.()
    }
    const perPixel = (sensitivity ?? step) * (e.shiftKey ? 0.1 : 1)
    const raw = d.startValue + dx * perPixel
    const snapped = Math.round(raw / (step * (e.shiftKey ? 0.1 : 1))) * step * (e.shiftKey ? 0.1 : 1)
    onChange(clamp(snapped, min, max))
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      setDragging(false)
      onEnd?.()
    } else {
      setDraft(format ? format(value) : value.toFixed(precision))
      setEditing(true)
    }
  }
  const commit = () => {
    setEditing(false)
    const n = parse ? parse(draft) : Number(draft.replace(',', '.'))
    if (Number.isFinite(n)) onChange(clamp(n, min, max))
  }

  return (
    <div
      className={cx(s.scrub, dragging && s.dragging)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label={label}
      role="spinbutton"
      aria-valuenow={value}
      style={disabled ? { opacity: 0.4 } : undefined}
    >
      {editing ? (
        <input
          autoFocus
          className={s.scrubInput}
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
        <>
          <span className={s.scrubValue}>{display}</span>
          {unit && <span className={s.scrubUnit}>{unit}</span>}
        </>
      )}
    </div>
  )
}

interface SliderProps extends GestureHandlers {
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  label?: string
}

export function Slider({ value, min, max, step = 0.01, disabled, label, onStart, onChange, onEnd }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const active = useRef(false)
  const pct = ((clamp(value, min, max) - min) / (max - min)) * 100

  const valueAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect()
    const u = clamp((clientX - rect.left) / rect.width, 0, 1)
    return clamp(Math.round((min + u * (max - min)) / step) * step, min, max)
  }
  return (
    <div
      ref={ref}
      className={s.slider}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={disabled ? -1 : 0}
      style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        active.current = true
        onStart?.()
        onChange(valueAt(e.clientX))
      }}
      onPointerMove={(e) => active.current && onChange(valueAt(e.clientX))}
      onPointerUp={() => {
        if (!active.current) return
        active.current = false
        onEnd?.()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          e.stopPropagation()
          onChange(clamp(value + (e.key === 'ArrowRight' ? step : -step) * (e.shiftKey ? 10 : 1), min, max))
        }
      }}
    >
      <div className={s.sliderTrack}>
        <div className={s.sliderFill} style={{ width: `${pct}%` }} />
        <div className={s.sliderThumb} style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  width
}: {
  value: T
  options: SelectOption<T>[]
  onChange(v: T): void
  label?: string
  width?: number
}) {
  return (
    <RSelect.Root value={value} onValueChange={(v) => onChange(v as T)}>
      <RSelect.Trigger className={s.selectTrigger} aria-label={label} style={width ? { width } : undefined}>
        <RSelect.Value />
        <RSelect.Icon>
          <ChevronDown />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className={s.menu} position="popper" sideOffset={4}>
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item key={o.value} value={o.value} className={s.menuItem}>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator className={s.menuShortcut}>
                  <Check />
                </RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  )
}

/** Calls fn after `ms` of no changes to `value` (for text fields that save as you type). */
export function useDebounced<T>(value: T, ms: number, fn: (v: T) => void) {
  const first = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => fnRef.current(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
}
