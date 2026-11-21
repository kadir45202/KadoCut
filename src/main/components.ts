import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { COMPONENTS, type ComponentId, type ComponentStatus } from '@shared/components'
import { paths } from './paths'

/** A component is installed once the worker wrote its marker after a complete download. */
export const INSTALLED_MARKER = '.installed'

export function componentStatuses(): ComponentStatus[] {
  return (Object.keys(COMPONENTS) as ComponentId[]).map((id) => ({
    id,
    installed: existsSync(join(paths.componentsDir(), id, INSTALLED_MARKER)),
    size: COMPONENTS[id].size
  }))
}

export async function removeComponent(id: ComponentId): Promise<void> {
  if (!(id in COMPONENTS)) throw new Error(`Unknown component ${id}`)
  await rm(join(paths.componentsDir(), id), { recursive: true, force: true })
}
