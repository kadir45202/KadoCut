import { ContextMenu as RContext, Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from 'radix-ui'
import type { ReactNode } from 'react'
import s from './ui.module.css'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={500} skipDelayDuration={200}>
      {children}
    </RTooltip.Provider>
  )
}

export function Tooltip({ content, keys, children, side = 'top' }: { content: ReactNode; keys?: string; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className={s.tooltip} side={side} sideOffset={6}>
          {content}
          {keys && <span className={s.tooltipKeys}>{keys}</span>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  )
}

interface DialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Dialog({ open, onOpenChange, title, description, children, footer, wide }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className={s.overlay} />
        <RDialog.Content className={`${s.dialog} ${wide ? s.dialogWide : ''}`} aria-describedby={undefined} onKeyDown={(e) => e.stopPropagation()}>
          <RDialog.Title className={s.dialogTitle}>{title}</RDialog.Title>
          {description && <RDialog.Description className={s.dialogDesc}>{description}</RDialog.Description>}
          {children}
          {footer && <div className={s.dialogFooter}>{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  )
}

export interface MenuEntry {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  onSelect(): void
}

function entries(Item: typeof RMenu.Item | typeof RContext.Item, Separator: typeof RMenu.Separator | typeof RContext.Separator, items: MenuEntry[]) {
  return items.map((it, i) => (
    <div key={it.id} style={{ display: 'contents' }}>
      {it.separatorBefore && i > 0 && <Separator className={s.menuSeparator} />}
      <Item className={`${s.menuItem} ${it.danger ? s.menuItemDanger : ''}`} disabled={it.disabled} onSelect={it.onSelect}>
        {it.icon}
        {it.label}
        {it.shortcut && <span className={s.menuShortcut}>{it.shortcut}</span>}
      </Item>
    </div>
  ))
}

export function DropdownMenu({ trigger, items, align = 'start' }: { trigger: ReactNode; items: MenuEntry[]; align?: 'start' | 'end' }) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content className={s.menu} align={align} sideOffset={4} onKeyDown={(e) => e.stopPropagation()}>
          {entries(RMenu.Item, RMenu.Separator, items)}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  )
}

export function ContextMenu({ items, children, onOpen }: { items: MenuEntry[]; children: ReactNode; onOpen?(): void }) {
  return (
    <RContext.Root onOpenChange={(open) => open && onOpen?.()}>
      <RContext.Trigger asChild>{children}</RContext.Trigger>
      <RContext.Portal>
        <RContext.Content className={s.menu} onKeyDown={(e) => e.stopPropagation()}>
          {entries(RContext.Item, RContext.Separator, items)}
        </RContext.Content>
      </RContext.Portal>
    </RContext.Root>
  )
}

export function Popover({ trigger, children, align = 'center', open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'center' | 'end'; open?: boolean; onOpenChange?(o: boolean): void }) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content className={s.popover} align={align} sideOffset={6} onKeyDown={(e) => e.stopPropagation()}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  )
}
