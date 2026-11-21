import type { ComponentType } from 'react'
import type { Asset, Clip, Project } from '@shared/project/schema'

/**
 * A Maker module is a self-contained tool. It contributes commands, buttons, inspector
 * sections, side panels, menu items and viewer overlays. Modules never mutate the project
 * directly — they go through projectActions.apply(), which validates every edit — and each
 * contribution is isolated: a throwing command or crashing panel only affects its module.
 */
export interface ModuleDef {
  id: string
  /** Display name (already translated for the current language). */
  name(): string
  description?(): string
  /** Core modules cannot be disabled in Settings. */
  core?: boolean
  commands?: CommandDef[]
  toolbar?: ToolbarDef[]
  inspector?: InspectorDef[]
  panels?: PanelDef[]
  clipMenu?: ClipMenuDef[]
  /** Items in the Media panel's right-click menu. */
  assetMenu?: AssetMenuDef[]
  viewer?: ViewerOverlayDef[]
  /** Modal UI the module opens itself (rendered once in the editor, isolated per module). */
  dialogs?: { id: string; Component: ComponentType }[]
}

export interface CommandDef {
  id: string
  title(): string
  /** Key combos like 'mod+b', 'shift+delete', 'space' ('mod' = Ctrl). */
  keys?: string[]
  /** Shown in tooltips/menus (e.g. 'Ctrl+B'). */
  keyLabel?: string
  enabled?(): boolean
  run(): void | Promise<void>
}

export interface ToolbarDef {
  command: string
  icon: ComponentType
  order: number
}

export type InspectorTab = 'video' | 'audio' | 'speed' | 'text'

export interface InspectorDef {
  id: string
  tab: InspectorTab
  order: number
  when(clip: Clip, project: Project): boolean
  Component: ComponentType<{ clip: Clip }>
}

export interface PanelDef {
  id: string
  title(): string
  icon: ComponentType
  order: number
  Component: ComponentType
}

export interface ClipMenuDef {
  command: string
  icon?: ComponentType
  order: number
  separatorBefore?: boolean
}

export interface AssetMenuDef {
  id: string
  title(): string
  icon?: ComponentType
  order: number
  when(asset: Asset): boolean
  run(asset: Asset): void | Promise<void>
}

/** Geometry of the viewer so overlays can map canvas pixels to screen pixels. */
export interface ViewerGeometry {
  /** Screen pixels per canvas pixel. */
  scale: number
  /** Canvas (project) resolution. */
  width: number
  height: number
}

export interface ViewerOverlayDef {
  id: string
  order: number
  when(clip: Clip): boolean
  Component: ComponentType<{ clip: Clip; geometry: ViewerGeometry }>
}

export const defineModule = (def: ModuleDef) => def
