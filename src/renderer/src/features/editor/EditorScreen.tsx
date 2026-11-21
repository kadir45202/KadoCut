import { ChevronLeft, Download, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useProject, projectActions } from '@renderer/core/store/project'
import { useT } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { Button, IconButton } from '@renderer/ui/controls'
import { getPreview } from '@renderer/engine/preview'
import { TitleBar } from '../app/TitleBar'
import { ExportDialog } from '../export/ExportDialog'
import { JobsIndicator } from '../jobs/JobsIndicator'
import { SettingsDialog } from '../settings/SettingsDialog'
import { Timeline } from '../timeline/Timeline'
import { Inspector } from './Inspector'
import { LeftPanel } from './LeftPanel'
import { ProjectTitle } from './ProjectTitle'
import { Toolbar } from './Toolbar'
import { Viewer } from './Viewer'
import s from './editor.module.css'
import { exportRequests } from '../export/exportRequests'
import { ModuleBoundary } from '@renderer/core/modules/ModuleBoundary'
import { activeModules, useModules } from '@renderer/core/modules/registry'

const TIMELINE_MIN = 160
const TIMELINE_DEFAULT = 300

export function EditorScreen() {
  const t = useT()
  const projectId = useProject((st) => st.project!.id)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [timelineH, setTimelineH] = useState(TIMELINE_DEFAULT)
  const dragging = useRef<{ y: number; h: number } | null>(null)

  useEffect(() => exportRequests.subscribe(() => setExportOpen(true)), [])

  // Refresh the home-screen thumbnail every minute while editing.
  useEffect(() => {
    const id = setInterval(() => saveThumbnail(projectId), 60_000)
    return () => clearInterval(id)
  }, [projectId])

  const goHome = async () => {
    getPreview()?.pause()
    await saveThumbnail(projectId)
    await projectActions.close()
  }

  return (
    <div className={s.screen}>
      <TitleBar
        left={
          <Button variant="ghost" size="sm" icon={<ChevronLeft />} onClick={goHome}>
            {t('editor.projects')}
          </Button>
        }
        center={<ProjectTitle />}
        right={
          <>
            <JobsIndicator />
            <IconButton label={t('settings.title')} onClick={() => setSettingsOpen(true)}>
              <Settings />
            </IconButton>
            <Button variant="primary" size="sm" icon={<Download />} onClick={() => setExportOpen(true)}>
              {t('export.button')}
            </Button>
          </>
        }
      />
      <div className={s.workspace} style={{ gridTemplateRows: `minmax(0, 1fr) 5px ${timelineH}px` }}>
        <div className={s.top}>
          <LeftPanel />
          <Viewer />
          <Inspector />
        </div>
        <div
          className={s.splitter}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            dragging.current = { y: e.clientY, h: timelineH }
          }}
          onPointerMove={(e) => {
            const d = dragging.current
            if (!d) return
            setTimelineH(Math.max(TIMELINE_MIN, Math.min(window.innerHeight - 300, d.h + d.y - e.clientY)))
          }}
          onPointerUp={() => (dragging.current = null)}
        />
        <div className={s.bottom}>
          <Toolbar />
          <Timeline />
        </div>
      </div>
      <ModuleDialogs />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

function ModuleDialogs() {
  const records = useModules((st) => st.records)
  return (
    <>
      {activeModules(records).flatMap((m) =>
        (m.dialogs ?? []).map((d) => (
          <ModuleBoundary key={`${m.id}:${d.id}`} moduleId={m.id} silent>
            <d.Component />
          </ModuleBoundary>
        ))
      )}
    </>
  )
}

async function saveThumbnail(projectId: string) {
  const dataUrl = getPreview()?.captureThumbnail()
  if (!dataUrl || !useProject.getState().project || Object.keys(useProject.getState().project!.clips).length === 0) return
  try {
    await api.projects.saveThumbnail(projectId, dataUrl)
  } catch (err) {
    log.warn('editor', `thumbnail save failed: ${String(err)}`)
  }
}
