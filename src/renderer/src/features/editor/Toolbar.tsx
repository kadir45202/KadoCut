import { Magnet, Maximize2, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { useMemo } from 'react'
import { activeModules, commandEnabled, findCommand, runCommand, useModules, type RegisteredCommand } from '@renderer/core/modules/registry'
import { editorActions, useEditor, ZOOM_MAX, ZOOM_MIN } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { useT } from '@renderer/i18n'
import { IconButton, Slider } from '@renderer/ui/controls'
import { HistoryMenu } from './History'
import s from './editor.module.css'

export function Toolbar() {
  const t = useT()
  const records = useModules((st) => st.records)
  // Re-evaluate enabled states when the selection/project/playhead change.
  useEditor((st) => st.selection)
  useEditor((st) => Math.round(st.playhead * 30))
  useProject((st) => st.project)
  const canUndo = useProject((st) => st.past.length > 0)
  const canRedo = useProject((st) => st.future.length > 0)
  const undoLabel = useProject((st) => st.past.at(-1)?.label)
  const redoLabel = useProject((st) => st.future[0]?.label)
  const zoom = useEditor((st) => st.pxPerSec)
  const snapping = useSettings((st) => st.settings.snapping)

  const tools = useMemo(() => {
    const list: { cmd: RegisteredCommand; icon: React.ComponentType; order: number }[] = []
    for (const m of activeModules(records)) {
      for (const tb of m.toolbar ?? []) {
        const cmd = m.commands?.find((c) => c.id === tb.command)
        if (cmd) list.push({ cmd: { ...cmd, moduleId: m.id }, icon: tb.icon, order: tb.order })
      }
    }
    return list.sort((a, b) => a.order - b.order)
  }, [records])

  // Zoom slider works on a log scale so it feels even across the range.
  const toSlider = (z: number) => Math.log(z / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)
  const fromSlider = (v: number) => ZOOM_MIN * (ZOOM_MAX / ZOOM_MIN) ** v

  return (
    <div className={s.toolbar}>
      <div className={s.toolGroup}>
        <IconButton label={undoLabel ? t('edit.undoNamed', { action: undoLabel }) : t('edit.undo')} keys="Ctrl+Z" disabled={!canUndo} onClick={projectActions.undo}>
          <Undo2 />
        </IconButton>
        <IconButton label={redoLabel ? t('edit.redoNamed', { action: redoLabel }) : t('edit.redo')} keys="Ctrl+Shift+Z" disabled={!canRedo} onClick={projectActions.redo}>
          <Redo2 />
        </IconButton>
        <HistoryMenu />
        <span className={s.toolDivider} />
        {tools.map(({ cmd, icon: Icon }) => (
          <IconButton key={cmd.id} label={cmd.title()} keys={findCommand(cmd.id)?.keyLabel} disabled={!commandEnabled(cmd)} onClick={() => void runCommand(cmd.id)}>
            <Icon />
          </IconButton>
        ))}
      </div>
      <div className={s.toolGroup}>
        <IconButton label={t('timeline.snapping')} keys="S" active={snapping} onClick={() => void settingsActions.update({ snapping: !snapping })}>
          <Magnet />
        </IconButton>
        <span className={s.toolDivider} />
        <IconButton label={t('timeline.zoomOut')} keys="-" onClick={() => editorActions.setZoom(zoom / 1.5)}>
          <ZoomOut />
        </IconButton>
        <div style={{ width: 110 }}>
          <Slider label={t('timeline.zoom')} min={0} max={1} step={0.001} value={toSlider(zoom)} onChange={(v) => editorActions.setZoom(fromSlider(v))} />
        </div>
        <IconButton label={t('timeline.zoomIn')} keys="=" onClick={() => editorActions.setZoom(zoom * 1.5)}>
          <ZoomIn />
        </IconButton>
        <IconButton label={t('timeline.fit')} keys="Shift+Z" onClick={() => void runCommand('core.zoomFit')}>
          <Maximize2 />
        </IconButton>
      </div>
    </div>
  )
}
