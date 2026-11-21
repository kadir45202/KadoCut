import { Music, Pause, Play, Plus, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { SfxItem } from '@shared/api'
import { addAssetToTimeline, importFiles } from '@renderer/core/media/import'
import { defineModule } from '@renderer/core/modules/types'
import { useEditor } from '@renderer/core/store/editor'
import { useProject } from '@renderer/core/store/project'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { api, mediaUrl } from '@renderer/lib/api'
import { shortDuration } from '@renderer/lib/format'
import { Button, IconButton } from '@renderer/ui/controls'
import { Empty } from '@renderer/ui/layout'
import { FILE_MIME } from '@renderer/features/editor/MediaPanel'
import s from './sfx.module.css'

const strings = defineStrings({
  tr: {
    name: 'Ses efektleri',
    desc: 'Geçiş, arayüz ve vurgu için hazır ses efektleri.',
    panel: 'Sesler',
    add: 'Oynatma çizgisine ekle',
    preview: 'Dinle',
    importOwn: 'Kendi efektini ekle',
    empty: 'Efekt kütüphanesi bulunamadı',
    'cat.transition': 'Geçiş',
    'cat.ui': 'Arayüz',
    'cat.impact': 'Vurgu',
    'cat.fun': 'Eğlenceli',
    'sfx.whoosh': 'Whoosh',
    'sfx.swoosh': 'Hızlı swoosh',
    'sfx.swipe': 'Kaydırma',
    'sfx.riser': 'Yükselen gerilim',
    'sfx.pop': 'Pop',
    'sfx.click': 'Tık',
    'sfx.ding': 'Ding',
    'sfx.notification': 'Bildirim',
    'sfx.success': 'Başarı',
    'sfx.error': 'Hata',
    'sfx.boom': 'Bum',
    'sfx.glitch': 'Glitch',
    'sfx.shutter': 'Deklanşör',
    'sfx.boing': 'Boing',
    'sfx.typing': 'Klavye',
    'sfx.sparkle': 'Parıltı'
  },
  en: {
    name: 'Sound effects',
    desc: 'Ready-made effects for transitions, UI moments and emphasis.',
    panel: 'Sounds',
    add: 'Add at playhead',
    preview: 'Preview',
    importOwn: 'Add your own effect',
    empty: 'Effect library not found',
    'cat.transition': 'Transition',
    'cat.ui': 'Interface',
    'cat.impact': 'Impact',
    'cat.fun': 'Fun',
    'sfx.whoosh': 'Whoosh',
    'sfx.swoosh': 'Fast swoosh',
    'sfx.swipe': 'Swipe',
    'sfx.riser': 'Riser',
    'sfx.pop': 'Pop',
    'sfx.click': 'Click',
    'sfx.ding': 'Ding',
    'sfx.notification': 'Notification',
    'sfx.success': 'Success',
    'sfx.error': 'Error',
    'sfx.boom': 'Boom',
    'sfx.glitch': 'Glitch',
    'sfx.shutter': 'Shutter',
    'sfx.boing': 'Boing',
    'sfx.typing': 'Typing',
    'sfx.sparkle': 'Sparkle'
  }
})
const tt = stringsT(strings)
const ID = 'sfx'
type Key = Parameters<typeof tt>[0]

/** Effects are copied into the project so projects stay self-contained across app updates. */
async function addAtPlayhead(path: string) {
  const copy = await api.media.copyToProject(useProject.getState().project!.id, path)
  const [asset] = await importFiles([copy])
  if (asset) addAssetToTimeline(asset, { at: useEditor.getState().playhead })
}

function SfxPanel() {
  const t = useStrings(strings)
  const [items, setItems] = useState<SfxItem[] | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    void api.media.sfx().then(setItems)
    return () => audio.current?.pause()
  }, [])

  const preview = (item: SfxItem) => {
    audio.current?.pause()
    if (playing === item.id) return setPlaying(null)
    const el = new Audio(mediaUrl(item.path))
    el.onended = () => setPlaying(null)
    void el.play()
    audio.current = el
    setPlaying(item.id)
  }

  const label = (id: string) => (`sfx.${id}` in strings.tr ? t(`sfx.${id}` as Key) : id)
  const categories = [...new Set((items ?? []).map((i) => i.category))]

  return (
    <div className={s.panel}>
      <Button size="sm" icon={<Upload />} onClick={async () => importFiles(await api.media.pickFiles('audio'))}>
        {t('importOwn')}
      </Button>
      {items && !items.length && <Empty icon={<Music />} title={t('empty')} />}
      {categories.map((cat) => (
        <section key={cat}>
          <h3 className={s.category}>{`cat.${cat}` in strings.tr ? t(`cat.${cat}` as Key) : cat}</h3>
          {items!
            .filter((i) => i.category === cat)
            .map((item) => (
              <div
                key={item.id}
                className={s.row}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FILE_MIME, item.path)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <IconButton small label={t('preview')} active={playing === item.id} onClick={() => preview(item)}>
                  {playing === item.id ? <Pause /> : <Play />}
                </IconButton>
                <span className={s.name}>{label(item.id)}</span>
                <span className={s.duration}>{shortDuration(item.duration)}</span>
                <IconButton small label={t('add')} onClick={() => void addAtPlayhead(item.path)}>
                  <Plus />
                </IconButton>
              </div>
            ))}
        </section>
      ))}
    </div>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  panels: [{ id: 'sfx', title: () => tt('panel'), icon: Music, order: 20, Component: SfxPanel }]
})
