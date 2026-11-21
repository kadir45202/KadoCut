import type { OpenedProject } from '@shared/api'
import { analyzeAsset } from '@renderer/core/media/media'
import { editorActions } from '@renderer/core/store/editor'
import { projectActions } from '@renderer/core/store/project'
import { translate } from '@renderer/i18n'
import { toast } from '@renderer/ui/toast'

/** Shows a created / opened project in the editor. */
export function openProject(opened: OpenedProject) {
  editorActions.reset()
  projectActions.load(opened)
  Object.values(opened.project.assets).forEach(analyzeAsset)
  if (opened.recovered) toast.info(translate('project.recovered'))
  if (opened.missing.length) toast.error(translate('project.missingMedia', { count: opened.missing.length }))
}
