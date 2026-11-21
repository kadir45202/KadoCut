import { Aperture, AudioLines, Brush, Bookmark, Download, FolderSearch, Images, LayoutGrid, Palette, Sparkles, Wand2 } from 'lucide-react'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { useT, type TKey } from '@renderer/i18n'
import { Button } from '@renderer/ui/controls'
import { Dialog } from '@renderer/ui/overlays'
import s from './whatsnew.module.css'

/** Bump when the notes below change; the dialog shows once per notes version. */
export const WHATS_NEW_VERSION = '0.5'

const ITEMS: { icon: React.ComponentType; title: TKey; text: TKey }[] = [
  { icon: Brush, title: 'whatsNew.photoPro', text: 'whatsNew.photoProText' },
  { icon: Aperture, title: 'whatsNew.photos', text: 'whatsNew.photosText' },
  { icon: Sparkles, title: 'whatsNew.effects', text: 'whatsNew.effectsText' },
  { icon: LayoutGrid, title: 'whatsNew.viewer', text: 'whatsNew.viewerText' },
  { icon: Bookmark, title: 'whatsNew.timeline', text: 'whatsNew.timelineText' },
  { icon: AudioLines, title: 'whatsNew.audio', text: 'whatsNew.audioText' },
  { icon: Download, title: 'whatsNew.export', text: 'whatsNew.exportText' },
  { icon: Wand2, title: 'whatsNew.clips', text: 'whatsNew.clipsText' },
  { icon: Palette, title: 'whatsNew.color', text: 'whatsNew.colorText' },
  { icon: Images, title: 'whatsNew.slideshow', text: 'whatsNew.slideshowText' },
  { icon: FolderSearch, title: 'whatsNew.media', text: 'whatsNew.mediaText' }
]

/** "What's new" sheet, shown once after an update (and on first start). */
export function WhatsNew() {
  const t = useT()
  const seen = useSettings((st) => st.settings.whatsNewSeen)
  const loaded = useSettings((st) => st.loaded)
  const open = loaded && seen !== WHATS_NEW_VERSION
  const dismiss = () => void settingsActions.update({ whatsNewSeen: WHATS_NEW_VERSION })
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && dismiss()}
      title={t('whatsNew.title')}
      description={t('whatsNew.subtitle')}
      wide
      footer={
        <Button variant="primary" onClick={dismiss}>
          {t('whatsNew.start')}
        </Button>
      }
    >
      <div className={s.grid}>
        {ITEMS.map(({ icon: Icon, title, text }) => (
          <div key={title} className={s.item}>
            <span className={s.icon}>
              <Icon />
            </span>
            <div>
              <div className={s.itemTitle}>{t(title)}</div>
              <div className={s.itemText}>{t(text)}</div>
            </div>
          </div>
        ))}
      </div>
      <p className={s.tip}>{t('whatsNew.tip')}</p>
    </Dialog>
  )
}
