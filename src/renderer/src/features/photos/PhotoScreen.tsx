import { Component, useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, Download, ImagePlus } from 'lucide-react'
import { photoActions, usePhotos, visiblePhotos, type PhotoView } from '@renderer/core/store/photos'
import { useT, translate } from '@renderer/i18n'
import { Button, Segmented } from '@renderer/ui/controls'
import { ErrorCard } from '@renderer/ui/layout'
import { TitleBar } from '../app/TitleBar'
import { Develop } from './Develop'
import { Library } from './Library'
import { PhotoExport } from './PhotoExport'
import { useDevelopUi } from './developUi'
import s from './photos.module.css'

/** A crash in the photo studio shows an error card instead of taking down the app. */
class PhotoBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={s.crashed}>
        <ErrorCard
          title={translate('photo.crashed')}
          message={this.state.error.message}
          action={
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              {translate('common.retry')}
            </Button>
          }
        />
      </div>
    )
  }
}

const isTyping = (el: EventTarget | null) => {
  const e = el as HTMLElement | null
  return !!e && (e.isContentEditable || e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT')
}

/** Lightroom shortcuts: G/D views, 0–5 stars, P/X/U flags, \ before/after, R crop, J clipping, Z 1:1, O mask overlay, [ ] brush size, Ctrl+Z… */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return
      const s = usePhotos.getState()
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      const targets = photoActions.targets()
      const handled = () => e.preventDefault()
      if (mod && key === 'z' && !e.shiftKey && s.currentId) return handled(), photoActions.undo(s.currentId)
      if (mod && (key === 'y' || (key === 'z' && e.shiftKey)) && s.currentId) return handled(), photoActions.redo(s.currentId)
      if (mod && e.shiftKey && key === 'c' && s.currentId) return handled(), photoActions.copySettings(s.currentId)
      if (mod && e.shiftKey && key === 'v') return handled(), photoActions.pasteSettings(targets)
      if (mod && key === 'a' && s.view === 'library') return handled(), photoActions.select(visiblePhotos(s).map((p) => p.id))
      if (mod) return
      if (key === 'g') return handled(), photoActions.setView('library')
      if (key === 'd' || (key === 'enter' && s.view === 'library')) return handled(), photoActions.setView('develop')
      if (/^[0-5]$/.test(key)) return handled(), photoActions.setRating(targets, Number(key))
      if (key === 'p') return handled(), photoActions.setFlag(targets, 'pick')
      if (key === 'x') return handled(), photoActions.setFlag(targets, 'reject')
      if (key === 'u') return handled(), photoActions.setFlag(targets, 'none')
      if (key === 'arrowright') return handled(), photoActions.step(1)
      if (key === 'arrowleft') return handled(), photoActions.step(-1)
      if (s.view !== 'develop') return
      if (key === '\\') return handled(), useDevelopUi.setState((u) => ({ before: !u.before }))
      if (key === 'r') return handled(), useDevelopUi.setState((u) => ({ cropping: !u.cropping }))
      if (key === 'j') return handled(), useDevelopUi.setState((u) => ({ clip: !u.clip }))
      if (key === 'z') return handled(), useDevelopUi.setState((u) => ({ zoom: !u.zoom, center: [0.5, 0.5] }))
      if (key === 'o') return handled(), useDevelopUi.setState((u) => ({ overlay: !u.overlay }))
      if (key === '[' || key === ']') {
        handled()
        return useDevelopUi.setState((u) => ({ brush: { ...u.brush, size: Math.min(0.25, Math.max(0.005, u.brush.size * (key === ']' ? 1.25 : 0.8))) } }))
      }
      if (key === 'escape') return useDevelopUi.setState((u) => (u.cropping ? { cropping: false } : { mask: null }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export function PhotoScreen() {
  const t = useT()
  const view = usePhotos((st) => st.view)
  const loaded = usePhotos((st) => !!st.catalog)
  const importing = usePhotos((st) => st.importing)
  const [exportIds, setExportIds] = useState<string[] | null>(null)
  useShortcuts()

  // Leaving the screen (or switching photos) closes the crop tool.
  useEffect(() => () => useDevelopUi.setState({ cropping: false, before: false, hover: null, mask: null, zoom: false }), [])

  return (
    <div className={s.screen}>
      <TitleBar
        left={
          <Button variant="ghost" size="sm" icon={<ChevronLeft />} onClick={() => void photoActions.close()}>
            {t('editor.projects')}
          </Button>
        }
        center={
          <span className="no-drag">
            <Segmented<PhotoView>
              value={view}
              onChange={(v) => photoActions.setView(v)}
              options={[
                { value: 'library', label: `${t('photo.library')} (G)` },
                { value: 'develop', label: `${t('photo.developView')} (D)` }
              ]}
            />
          </span>
        }
        right={
          <>
            <Button size="sm" icon={<ImagePlus />} disabled={importing} onClick={() => void photoActions.import()}>
              {t('photo.import')}
            </Button>
            <Button size="sm" variant="primary" icon={<Download />} onClick={() => setExportIds(photoActions.targets())}>
              {t('photo.export')}
            </Button>
          </>
        }
      />
      <PhotoBoundary>{!loaded ? <div className={s.emptyDevelop}>{t('photo.loading')}</div> : view === 'library' ? <Library /> : <Develop />}</PhotoBoundary>
      <PhotoExport ids={exportIds ?? []} open={!!exportIds} onOpenChange={(o) => !o && setExportIds(null)} />
    </div>
  )
}
