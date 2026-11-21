import { Aperture, ArrowDownFromLine, ArrowLeftFromLine, ArrowRightFromLine, ArrowUpFromLine, Blend, Moon, MoveHorizontal, RotateCw, SquareSplitHorizontal, Sun, Wind, Zap, ZapOff, ZoomIn, ZoomOut } from 'lucide-react'
import type { TransitionType } from '@shared/project/schema'

const ICONS: Record<TransitionType, React.ComponentType> = {
  dissolve: Blend,
  fadeBlack: Moon,
  fadeWhite: Sun,
  slideLeft: ArrowLeftFromLine,
  slideUp: ArrowUpFromLine,
  push: MoveHorizontal,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  whip: Wind,
  wipe: SquareSplitHorizontal,
  slideRight: ArrowRightFromLine,
  slideDown: ArrowDownFromLine,
  spin: RotateCw,
  flash: Zap,
  glitch: ZapOff,
  iris: Aperture
}

export function TransitionIcon({ type }: { type: TransitionType }) {
  const Icon = ICONS[type]
  return <Icon />
}
