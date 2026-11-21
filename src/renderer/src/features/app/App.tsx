import { useEffect, useState } from 'react'
import { installKeymap } from '@renderer/core/modules/keymap'
import { loadModules } from '@renderer/core/modules/registry'
import { initJobs } from '@renderer/core/store/jobs'
import { fontActions } from '@renderer/core/fonts/fonts'
import { projectActions, useProject } from '@renderer/core/store/project'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { TooltipProvider } from '@renderer/ui/overlays'
import { Toasts } from '@renderer/ui/toast'
import { ComponentPrompt } from '../components/ComponentPrompt'
import { EditorScreen } from '../editor/EditorScreen'
import { HomeScreen } from '../home/HomeScreen'
import { setTextLocale } from '@renderer/engine/text'
import { WhatsNew } from './WhatsNew'
import { openProject } from './openProject'
import { photoActions, usePhotos } from '@renderer/core/store/photos'
import { PhotoScreen } from '../photos/PhotoScreen'

export function App() {
  const [booted, setBooted] = useState(false)
  const project = useProject((s) => s.project)
  const photos = usePhotos((s) => s.open)
  const lang = useSettings((s) => s.settings.language)

  useEffect(() => {
    initJobs()
    void (async () => {
      await settingsActions.load()
      await Promise.all([loadModules(useSettings.getState().settings.disabledModules), fontActions.loadCustom().catch(() => {})])
      setBooted(true)
    })()
    return installKeymap()
  }, [])

  useEffect(() => setTextLocale(lang), [lang])

  // Unsaved edits are written immediately when the window closes.
  useEffect(() => {
    const flush = () => {
      void projectActions.flush()
      void photoActions.flush()
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  if (!booted) return <div style={{ height: '100%', background: 'var(--bg-window)' }} className="drag" />

  return (
    <TooltipProvider>
      {project ? <EditorScreen /> : photos ? <PhotoScreen /> : <HomeScreen onOpen={openProject} />}
      <ComponentPrompt />
      <WhatsNew />
      <Toasts />
    </TooltipProvider>
  )
}
