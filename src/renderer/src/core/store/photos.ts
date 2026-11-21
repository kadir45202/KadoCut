import { produce, type Draft } from 'immer'
import { create } from 'zustand'
import { MAX_MASKS, defaultDevelop, defaultLocalAdjust, type MaskKind, type Photo, type PhotoCatalog, type PhotoDevelop, type PhotoFlag, type PhotoMask } from '@shared/photo'
import { forgetThumb, loadPhotoBitmap } from '@renderer/engine/photo/images'
import { applyPreset } from '@renderer/engine/photo/presets'
import { translate } from '@renderer/i18n'
import { api, log } from '@renderer/lib/api'
import { toast } from '@renderer/ui/toast'
import { newId } from '../project/factory'

export type PhotoView = 'library' | 'develop'
export type FlagFilter = 'all' | 'pick' | 'unflagged' | 'reject'
export type PhotoSort = 'added' | 'name' | 'rating'

interface History {
  past: PhotoDevelop[]
  future: PhotoDevelop[]
}

interface PhotoState {
  /** The photo studio screen is showing. */
  open: boolean
  catalog: PhotoCatalog | null
  view: PhotoView
  /** Photo shown in Develop (and the "active" one in the grid). */
  currentId: string | null
  selection: string[]
  minRating: number
  flagFilter: FlagFilter
  sort: PhotoSort
  clipboard: PhotoDevelop | null
  history: Record<string, History>
  importing: boolean
}

export const usePhotos = create<PhotoState>(() => ({
  open: false,
  catalog: null,
  view: 'library',
  currentId: null,
  selection: [],
  minRating: 0,
  flagFilter: 'all',
  sort: 'added',
  clipboard: null,
  history: {},
  importing: false
}))

const SAVE_DELAY = 800
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** Develop state before the current slider gesture. */
let gesture: { id: string; base: PhotoDevelop } | null = null

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flush(), SAVE_DELAY)
}

async function flush() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  const catalog = usePhotos.getState().catalog
  if (!catalog) return
  try {
    await api.photos.save(catalog)
  } catch (err) {
    log.error('photos', 'catalog save failed', err)
    toast.error(translate('photo.saveFailed'), err instanceof Error ? err.message : String(err))
  }
}

function mutate(fn: (c: Draft<PhotoCatalog>) => void) {
  const catalog = usePhotos.getState().catalog
  if (!catalog) return
  usePhotos.setState({ catalog: produce(catalog, fn) })
  scheduleSave()
}

const photo = (id: string) => usePhotos.getState().catalog?.photos.find((p) => p.id === id)

function pushHistory(id: string, before: PhotoDevelop) {
  usePhotos.setState((s) => {
    const h = s.history[id] ?? { past: [], future: [] }
    return { history: { ...s.history, [id]: { past: [...h.past.slice(-99), before], future: [] } } }
  })
}

function setDevelop(id: string, next: PhotoDevelop) {
  mutate((c) => {
    const p = c.photos.find((x) => x.id === id)
    if (p) p.develop = next
  })
}

/** Photos visible under the current rating / flag filter, in the chosen order. */
export function visiblePhotos(s: Pick<PhotoState, 'catalog' | 'minRating' | 'flagFilter'> & { sort?: PhotoSort }): Photo[] {
  const list = (s.catalog?.photos ?? []).filter((p) => {
    if (p.rating < s.minRating) return false
    if (s.flagFilter === 'all') return p.flag !== 'reject'
    if (s.flagFilter === 'unflagged') return p.flag === 'none'
    return p.flag === s.flagFilter
  })
  // Stable sorts keep catalog order (and virtual copies next to their originals) within ties.
  if (s.sort === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (s.sort === 'rating') return list.sort((a, b) => b.rating - a.rating)
  return list
}

/** A new mask of the given kind, placed in the middle of the frame. */
export function newMask(kind: MaskKind, id: string): PhotoMask {
  const base = { id, invert: false, adjust: defaultLocalAdjust() }
  if (kind === 'radial') return { ...base, kind, cx: 0.5, cy: 0.5, rx: 0.22, ry: 0.16, angle: 0, feather: 0.5 }
  if (kind === 'linear') return { ...base, kind, x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.55 }
  return { ...base, kind, strokes: [] }
}

export const photoActions = {
  async open() {
    usePhotos.setState({ open: true })
    if (usePhotos.getState().catalog) return
    try {
      usePhotos.setState({ catalog: await api.photos.load() })
    } catch (err) {
      log.error('photos', 'catalog load failed', err)
      toast.error(translate('photo.loadFailed'), err instanceof Error ? err.message : String(err))
    }
  },

  async close() {
    await flush()
    usePhotos.setState({ open: false })
  },

  setView(view: PhotoView) {
    const s = usePhotos.getState()
    if (view === 'develop' && !s.currentId) {
      const first = s.selection[0] ?? visiblePhotos(s)[0]?.id ?? null
      usePhotos.setState({ currentId: first })
    }
    usePhotos.setState({ view })
  },

  /** Picks (or takes) files and adds them to the catalog; returns how many were added. */
  async import(paths?: string[]): Promise<number> {
    const files = paths ?? (await api.photos.pick())
    if (!files.length) return 0
    usePhotos.setState({ importing: true })
    const known = new Set((usePhotos.getState().catalog?.photos ?? []).filter((p) => !p.copyOf).map((p) => p.path.toLowerCase()))
    const added: Photo[] = []
    const failed: string[] = []
    try {
      for (const probe of await api.photos.prepare(files.filter((f) => !known.has(f.toLowerCase())))) {
        if (!probe.ok) {
          failed.push(probe.path.split(/[\\/]/).pop() ?? probe.path)
          continue
        }
        try {
          // Decoding gives the displayed size (EXIF orientation applied).
          const bmp = await loadPhotoBitmap(probe)
          added.push({
            id: newId(),
            path: probe.path,
            preview: probe.preview,
            name: probe.name,
            width: bmp.width,
            height: bmp.height,
            addedAt: Date.now(),
            rating: 0,
            flag: 'none',
            develop: defaultDevelop(),
            copyOf: '',
            snapshots: []
          })
          bmp.close()
        } catch {
          failed.push(probe.name)
        }
      }
    } finally {
      usePhotos.setState({ importing: false })
    }
    if (added.length) {
      mutate((c) => void c.photos.push(...added))
      usePhotos.setState({ selection: added.map((p) => p.id), currentId: added[0].id })
    }
    if (failed.length) toast.error(translate('photo.importFailed'), failed.join(', '))
    return added.length
  },

  remove(ids: string[]) {
    const set = new Set(ids)
    mutate((c) => void (c.photos = c.photos.filter((p) => !set.has(p.id))))
    ids.forEach(forgetThumb)
    const s = usePhotos.getState()
    usePhotos.setState({ selection: s.selection.filter((id) => !set.has(id)), currentId: s.currentId && set.has(s.currentId) ? null : s.currentId })
  },

  select(ids: string[], additive = false) {
    const s = usePhotos.getState()
    if (!additive) return usePhotos.setState({ selection: ids, currentId: ids[0] ?? s.currentId })
    const next = new Set(s.selection)
    for (const id of ids) {
      if (next.has(id)) next.delete(id)
      else next.add(id)
    }
    usePhotos.setState({ selection: [...next], currentId: ids[0] ?? s.currentId })
  },

  /** Targets of rating / flag / preset actions: the selection, or the current photo. */
  targets(): string[] {
    const s = usePhotos.getState()
    if (s.view === 'develop' && s.currentId) return [s.currentId]
    return s.selection.length ? s.selection : s.currentId ? [s.currentId] : []
  },

  setRating(ids: string[], rating: number) {
    const set = new Set(ids)
    mutate((c) => c.photos.forEach((p) => set.has(p.id) && (p.rating = rating)))
  },

  setFlag(ids: string[], flag: PhotoFlag) {
    const set = new Set(ids)
    mutate((c) => c.photos.forEach((p) => set.has(p.id) && (p.flag = flag)))
  },

  setFilter(patch: Partial<Pick<PhotoState, 'minRating' | 'flagFilter' | 'sort'>>) {
    usePhotos.setState(patch)
  },

  /** One undoable develop edit. */
  edit(id: string, recipe: (d: Draft<PhotoDevelop>) => void) {
    const p = photo(id)
    if (!p) return
    pushHistory(id, p.develop)
    setDevelop(id, produce(p.develop, recipe))
  },

  /** Slider gestures: begin → many transient updates → end (one undo step). */
  begin(id: string) {
    const p = photo(id)
    if (p) gesture = { id, base: p.develop }
  },
  transient(id: string, recipe: (d: Draft<PhotoDevelop>) => void) {
    const p = photo(id)
    if (!p) return
    if (!gesture || gesture.id !== id) gesture = { id, base: p.develop }
    setDevelop(id, produce(p.develop, recipe))
  },
  end(id: string) {
    const p = photo(id)
    if (gesture?.id === id && p && p.develop !== gesture.base) pushHistory(id, gesture.base)
    gesture = null
  },

  undo(id: string) {
    const h = usePhotos.getState().history[id]
    const p = photo(id)
    if (!h?.past.length || !p) return
    const prev = h.past[h.past.length - 1]
    usePhotos.setState((s) => ({ history: { ...s.history, [id]: { past: h.past.slice(0, -1), future: [p.develop, ...h.future] } } }))
    setDevelop(id, prev)
  },

  redo(id: string) {
    const h = usePhotos.getState().history[id]
    const p = photo(id)
    if (!h?.future.length || !p) return
    const next = h.future[0]
    usePhotos.setState((s) => ({ history: { ...s.history, [id]: { past: [...h.past, p.develop], future: h.future.slice(1) } } }))
    setDevelop(id, next)
  },

  applyPreset(ids: string[], preset: Partial<PhotoDevelop>) {
    for (const id of ids) {
      const p = photo(id)
      if (!p) continue
      pushHistory(id, p.develop)
      setDevelop(id, applyPreset(p.develop, preset))
    }
  },

  /** Resets everything but the crop (or the crop too). */
  reset(ids: string[], withCrop = false) {
    for (const id of ids) {
      const p = photo(id)
      if (!p) continue
      pushHistory(id, p.develop)
      setDevelop(id, { ...defaultDevelop(), crop: withCrop ? defaultDevelop().crop : p.develop.crop })
    }
  },

  copySettings(id: string) {
    const p = photo(id)
    if (p) usePhotos.setState({ clipboard: structuredClone(p.develop) })
  },

  /** Pastes copied settings (except the crop, which belongs to each photo's framing). */
  pasteSettings(ids: string[]) {
    const clip = usePhotos.getState().clipboard
    if (clip) this.applyPreset(ids, clip)
  },

  /** Lightroom "virtual copy": a second entry for the same file with its own settings. */
  virtualCopy(id: string) {
    const p = photo(id)
    if (!p) return
    const copy: Photo = { ...structuredClone(p), id: newId(), copyOf: p.copyOf || p.id, addedAt: Date.now(), name: `${p.name} (${translate('photo.copy')})`, snapshots: [] }
    mutate((c) => {
      const i = c.photos.findIndex((x) => x.id === id)
      c.photos.splice(i + 1, 0, copy)
    })
    usePhotos.setState({ currentId: copy.id, selection: [copy.id] })
  },

  /** Adds a local adjustment mask; returns its id (null when the photo has the most it can). */
  addMask(id: string, kind: MaskKind): string | null {
    const p = photo(id)
    if (!p || p.develop.masks.length >= MAX_MASKS) return null
    const mask = newMask(kind, newId())
    this.edit(id, (d) => void d.masks.push(mask))
    return mask.id
  },

  removeMask(id: string, maskId: string) {
    this.edit(id, (d) => void (d.masks = d.masks.filter((m) => m.id !== maskId)))
  },

  /** Saves the current settings as a named snapshot. */
  saveSnapshot(id: string, name: string) {
    const p = photo(id)
    if (!p) return
    const snap = { id: newId(), name: name.slice(0, 60), at: Date.now(), develop: structuredClone(p.develop) }
    mutate((c) => {
      const x = c.photos.find((q) => q.id === id)
      if (x) x.snapshots = [snap, ...x.snapshots].slice(0, 50)
    })
  },

  /** Goes back to a snapshot (undoable). */
  applySnapshot(id: string, snapId: string) {
    const p = photo(id)
    const snap = p?.snapshots.find((x) => x.id === snapId)
    if (!p || !snap) return
    pushHistory(id, p.develop)
    setDevelop(id, structuredClone(snap.develop))
  },

  deleteSnapshot(id: string, snapId: string) {
    mutate((c) => {
      const x = c.photos.find((q) => q.id === id)
      if (x) x.snapshots = x.snapshots.filter((q) => q.id !== snapId)
    })
  },

  savePreset(name: string, develop: PhotoDevelop) {
    // Crop and masks belong to one photo's framing, so presets leave them out.
    const { crop: _crop, masks: _masks, ...rest } = structuredClone(develop)
    mutate((c) => void c.presets.push({ id: newId(), name: name.slice(0, 60), develop: rest }))
  },

  deletePreset(id: string) {
    mutate((c) => void (c.presets = c.presets.filter((p) => p.id !== id)))
  },

  /** Moves the current photo within the filtered list (filmstrip arrows). */
  step(delta: number) {
    const s = usePhotos.getState()
    const list = visiblePhotos(s)
    if (!list.length) return
    const i = Math.max(0, list.findIndex((p) => p.id === s.currentId))
    const next = list[Math.min(list.length - 1, Math.max(0, i + delta))]
    usePhotos.setState({ currentId: next.id, selection: [next.id] })
  },

  flush
}
