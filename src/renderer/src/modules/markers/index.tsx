import { useState } from 'react'
import { Bookmark, Copy, Trash2 } from 'lucide-react'
import { MARKER_COLORS } from '@shared/project/defaults'
import type { Marker, MarkerColor } from '@shared/project/schema'
import { defineModule } from '@renderer/core/modules/types'
import { snapToFrame } from '@renderer/core/project/clip'
import { newId } from '@renderer/core/project/factory'
import { projectDuration } from '@renderer/core/project/timeline'
import { useEditor } from '@renderer/core/store/editor'
import { projectActions, useProject } from '@renderer/core/store/project'
import { seek } from '@renderer/engine/preview'
import { defineStrings, stringsT, useStrings } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { timecode } from '@renderer/lib/format'
import { Button, IconButton, TextInput } from '@renderer/ui/controls'
import { toast } from '@renderer/ui/toast'
import { youtubeChapters } from './chapters'
import s from './markers.module.css'

const strings = defineStrings({
  tr: {
    name: 'İşaretler ve aralık',
    desc: 'Zaman çizelgesine işaret koy, giriş/çıkış aralığı seç, YouTube bölüm listesi oluştur.',
    panel: 'İşaretler',
    add: 'İşaret ekle',
    next: 'Sonraki işarete git',
    prev: 'Önceki işarete git',
    setIn: 'Giriş noktası koy',
    setOut: 'Çıkış noktası koy',
    clearRange: 'Giriş/çıkış aralığını temizle',
    range: 'Aralık',
    noRange: 'Aralık yok. I ile giriş, O ile çıkış noktası koy; dışa aktarırken yalnızca bu aralık seçilebilir.',
    markers: 'İşaretler',
    empty: 'Henüz işaret yok. Oynatma çizgisindeyken M tuşuna bas.',
    label: 'İşaret adı',
    color: 'Rengi değiştir',
    remove: 'İşareti sil',
    rename: 'İşareti adlandır',
    move: 'İşareti taşı',
    chapters: 'YouTube bölümleri',
    chaptersHint: 'Açıklamaya yapıştır; YouTube videoyu bölümlere ayırır.',
    copy: 'Bölümleri kopyala',
    copied: 'Bölüm listesi panoya kopyalandı',
    intro: 'Giriş',
    chapter: 'Bölüm {n}',
    needMore: 'YouTube en az 3 bölüm ister; 2 işaret daha ekle.',
    tooShort: 'Her bölüm en az 10 saniye olmalı.',
    marker: 'İşaret {n}'
  },
  en: {
    name: 'Markers and range',
    desc: 'Mark points on the timeline, set an in/out range and build a YouTube chapter list.',
    panel: 'Markers',
    add: 'Add marker',
    next: 'Go to next marker',
    prev: 'Go to previous marker',
    setIn: 'Set in point',
    setOut: 'Set out point',
    clearRange: 'Clear in/out range',
    range: 'Range',
    noRange: 'No range. Press I for the in point and O for the out point; export can render just this range.',
    markers: 'Markers',
    empty: 'No markers yet. Press M at the playhead.',
    label: 'Marker name',
    color: 'Change colour',
    remove: 'Delete marker',
    rename: 'Rename marker',
    move: 'Move marker',
    chapters: 'YouTube chapters',
    chaptersHint: 'Paste into the description; YouTube splits the video into chapters.',
    copy: 'Copy chapters',
    copied: 'Chapter list copied to the clipboard',
    intro: 'Intro',
    chapter: 'Chapter {n}',
    needMore: 'YouTube needs at least 3 chapters; add 2 more markers.',
    tooShort: 'Every chapter must be at least 10 seconds long.',
    marker: 'Marker {n}'
  }
})
const tt = stringsT(strings)
const ID = 'markers'

const COLOR_ORDER = Object.keys(MARKER_COLORS) as MarkerColor[]

const project = () => useProject.getState().project
const hasProject = () => !!project()
const now = () => {
  const p = project()!
  return snapToFrame(useEditor.getState().playhead, p.settings.fps)
}

function addMarker() {
  const p = project()!
  const t = now()
  if (p.markers.some((m) => Math.abs(m.t - t) < 0.5 / p.settings.fps)) return
  projectActions.apply(
    tt('add'),
    (d) => {
      d.markers.push({ id: newId(), t, label: tt('marker', { n: d.markers.length + 1 }), color: 'blue' })
      d.markers.sort((a, b) => a.t - b.t)
    },
    ID
  )
}

function jump(dir: 1 | -1) {
  const p = project()!
  const t = useEditor.getState().playhead
  const eps = 0.5 / p.settings.fps
  const sorted = [...p.markers].sort((a, b) => a.t - b.t)
  const target = dir > 0 ? sorted.find((m) => m.t > t + eps) : [...sorted].reverse().find((m) => m.t < t - eps)
  if (target) seek(target.t)
}

function setRangeEdge(edge: 'in' | 'out') {
  const p = project()!
  const t = now()
  const end = projectDuration(p)
  projectActions.apply(
    edge === 'in' ? tt('setIn') : tt('setOut'),
    (d) => {
      const r = d.range ?? { in: 0, out: end }
      if (edge === 'in') r.in = t
      else r.out = t
      // Setting an edge past the other one starts a fresh range there.
      if (r.out <= r.in) {
        if (edge === 'in') r.out = Math.max(end, t + 1 / p.settings.fps)
        else r.in = 0
      }
      d.range = r
    },
    ID
  )
}

export function updateMarker(id: string, label: string, patch: Partial<Marker>) {
  projectActions.apply(
    label,
    (d) => {
      const m = d.markers.find((x) => x.id === id)
      if (m) Object.assign(m, patch)
      d.markers.sort((a, b) => a.t - b.t)
    },
    ID
  )
}

function removeMarker(id: string) {
  projectActions.apply(tt('remove'), (d) => void (d.markers = d.markers.filter((m) => m.id !== id)), ID)
}

function MarkerRow({ marker, fps }: { marker: Marker; fps: number }) {
  const t = useStrings(strings)
  const [label, setLabel] = useState(marker.label)
  const commit = () => label !== marker.label && updateMarker(marker.id, t('rename'), { label: label.slice(0, 200) })
  return (
    <div className={s.row}>
      <button
        type="button"
        className={s.dot}
        style={{ background: MARKER_COLORS[marker.color] }}
        aria-label={t('color')}
        title={t('color')}
        onClick={() => updateMarker(marker.id, t('color'), { color: COLOR_ORDER[(COLOR_ORDER.indexOf(marker.color) + 1) % COLOR_ORDER.length] })}
      />
      <button type="button" className={`${s.time} tabular`} onClick={() => seek(marker.t)}>
        {timecode(marker.t, fps).slice(3)}
      </button>
      <TextInput
        value={label}
        aria-label={t('label')}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      <IconButton label={t('remove')} small onClick={() => removeMarker(marker.id)}>
        <Trash2 />
      </IconButton>
    </div>
  )
}

function MarkersPanel() {
  const t = useStrings(strings)
  const p = useProject((st) => st.project!)
  const fps = p.settings.fps
  const duration = projectDuration(p)
  const chapters = youtubeChapters(p.markers, duration, t('intro'), (n) => t('chapter', { n }))
  return (
    <div className={s.panel}>
      <div className={s.buttons}>
        <Button size="sm" icon={<Bookmark />} onClick={addMarker}>
          {t('add')} (M)
        </Button>
        <Button size="sm" onClick={() => setRangeEdge('in')}>
          {t('setIn')} (I)
        </Button>
        <Button size="sm" onClick={() => setRangeEdge('out')}>
          {t('setOut')} (O)
        </Button>
      </div>

      <span className={s.title}>{t('range')}</span>
      {p.range ? (
        <div className={s.range}>
          <span className="tabular">
            {timecode(p.range.in, fps).slice(3)} – {timecode(p.range.out, fps).slice(3)} ({(p.range.out - p.range.in).toFixed(1)} s)
          </span>
          <Button size="sm" variant="ghost" onClick={() => projectActions.apply(t('clearRange'), (d) => void (d.range = null), ID)}>
            {t('clearRange')}
          </Button>
        </div>
      ) : (
        <span className={s.hint}>{t('noRange')}</span>
      )}

      <span className={s.title}>{t('markers')}</span>
      {p.markers.length === 0 && <span className={s.hint}>{t('empty')}</span>}
      {p.markers.map((m) => (
        <MarkerRow key={`${m.id}:${m.label}`} marker={m} fps={fps} />
      ))}

      <span className={s.title}>{t('chapters')}</span>
      <pre className={s.chapters} data-testid="chapters">
        {chapters.text}
      </pre>
      <span className={s.hint}>{chapters.count < 3 ? t('needMore') : chapters.tooShort ? t('tooShort') : t('chaptersHint')}</span>
      <Button
        size="sm"
        icon={<Copy />}
        onClick={async () => {
          await api.app.copyText(chapters.text)
          toast.success(t('copied'))
        }}
      >
        {t('copy')}
      </Button>
    </div>
  )
}

export default defineModule({
  id: ID,
  name: () => tt('name'),
  description: () => tt('desc'),
  commands: [
    { id: 'markers.add', title: () => tt('add'), keys: ['m'], keyLabel: 'M', enabled: hasProject, run: addMarker },
    { id: 'markers.next', title: () => tt('next'), keys: ['shift+m'], keyLabel: 'Shift+M', enabled: hasProject, run: () => jump(1) },
    { id: 'markers.prev', title: () => tt('prev'), keys: ['mod+shift+m'], keyLabel: 'Ctrl+Shift+M', enabled: hasProject, run: () => jump(-1) },
    { id: 'range.in', title: () => tt('setIn'), keys: ['i'], keyLabel: 'I', enabled: hasProject, run: () => setRangeEdge('in') },
    { id: 'range.out', title: () => tt('setOut'), keys: ['o'], keyLabel: 'O', enabled: hasProject, run: () => setRangeEdge('out') },
    {
      id: 'range.clear',
      title: () => tt('clearRange'),
      keys: ['alt+x'],
      keyLabel: 'Alt+X',
      enabled: () => !!project()?.range,
      run: () => projectActions.apply(tt('clearRange'), (d) => void (d.range = null), ID)
    }
  ],
  panels: [{ id: 'markers', title: () => tt('panel'), icon: Bookmark, order: 34, Component: MarkersPanel }]
})

