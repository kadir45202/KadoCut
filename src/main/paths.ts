import { app } from 'electron'
import { join } from 'node:path'

/** Optional override so automated tests never touch the user's real projects or settings. */
const dataRoot = process.env['MAKER_DATA_DIR']

const resourcesDir = () => (app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'))
const binDir = () => (app.isPackaged ? join(process.resourcesPath, 'bin') : join(resourcesDir(), 'bin', 'win'))

export const paths = {
  userData: () => app.getPath('userData'),
  dataRoot,
  projectsDir: () => (dataRoot ? join(dataRoot, 'Projects') : join(app.getPath('documents'), 'Maker', 'Projects')),
  /** Photo studio catalog (edits reference the original files). */
  photosDir: () => (dataRoot ? join(dataRoot, 'Photos') : join(app.getPath('documents'), 'Maker', 'Photos')),
  cacheDir: () => join(app.getPath('userData'), 'cache'),
  componentsDir: () => join(app.getPath('userData'), 'components'),
  logsDir: () => join(app.getPath('userData'), 'logs'),
  /** Font files the user added. */
  fontsDir: () => join(app.getPath('userData'), 'fonts'),
  /** Project templates the user saved. */
  templatesDir: () => join(app.getPath('userData'), 'templates'),
  resourcesDir,
  sfxDir: () => join(resourcesDir(), 'sfx'),
  ffmpeg: () => join(binDir(), 'ffmpeg.exe'),
  ffprobe: () => join(binDir(), 'ffprobe.exe')
}
