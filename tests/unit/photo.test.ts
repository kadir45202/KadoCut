import { describe, expect, it } from 'vitest'
import { PhotoCatalog, defaultDevelop, emptyCatalog, upgradeCatalog, type Photo, type PhotoMask } from '@shared/photo'
import { newMask, visiblePhotos } from '@renderer/core/store/photos'
import { autoTone } from '@renderer/engine/photo/auto'
import { aspectRatio, cropCorners, dragCrop, fitCrop, maxCrop, setAspect } from '@renderer/engine/photo/crop'
import { croppedSize } from '@renderer/engine/photo/develop'
import { exportName } from '@renderer/engine/photo/export'
import { MaskRaster, frameToView, linearWeight, maskSize, radialWeight, rasterMask, viewToFrame, zoomView } from '@renderer/engine/photo/masks'
import { BUILTIN_PRESETS, applyPreset, developKey, isDefaultDevelop } from '@renderer/engine/photo/presets'

const W = 6000
const H = 4000
const insidePhoto = (c: ReturnType<typeof defaultDevelop>['crop']) =>
  cropCorners(c, W, H).every(([x, y]) => x >= -0.6 && y >= -0.6 && x <= W + 0.6 && y <= H + 0.6)

describe('photo crop', () => {
  it('aspect presets', () => {
    expect(aspectRatio('original', W, H)).toBeCloseTo(1.5)
    expect(aspectRatio('4:5', W, H)).toBeCloseTo(0.8)
    expect(aspectRatio('free', W, H)).toBeNull()
  })

  it('a straightened crop is shrunk until it fits inside the photo', () => {
    const c = fitCrop({ ...defaultDevelop().crop, angle: 10 }, W, H)
    expect(insidePhoto(c)).toBe(true)
    expect(c.w).toBeLessThan(1)
    // Keeps the photo's shape and centre.
    expect((c.w * W) / (c.h * H)).toBeCloseTo(1.5, 3)
    expect(c.x + c.w / 2).toBeCloseTo(0.5, 5)
  })

  it('largest square crop', () => {
    const c = maxCrop('1:1', 0, W, H)
    expect(c.w * W).toBeCloseTo(4000, 0)
    expect(c.h * H).toBeCloseTo(4000, 0)
    expect(croppedSize(W, H, c, 1080)).toEqual({ width: 1080, height: 1080 })
  })

  it('reshapes to an aspect ratio around the centre', () => {
    const c = setAspect(defaultDevelop().crop, '9:16', W, H)
    expect((c.w * W) / (c.h * H)).toBeCloseTo(9 / 16, 3)
    expect(insidePhoto(c)).toBe(true)
  })

  it('dragging a corner keeps the opposite one and the ratio', () => {
    const start = maxCrop('original', 0, W, H)
    const next = dragCrop(start, 'se', [W, H], [W * 0.75, H * 0.9], W, H)
    expect(next.x).toBeCloseTo(start.x, 5)
    expect(next.y).toBeCloseTo(start.y, 5)
    expect((next.w * W) / (next.h * H)).toBeCloseTo(1.5, 3)
    expect(next.w).toBeLessThan(1)
    // Moving cannot push the crop off the photo.
    expect(dragCrop(next, 'move', [0, 0], [W, H], W, H)).toEqual(next)
  })
})

describe('photo presets', () => {
  it('apply only their own settings and never the crop', () => {
    const current = { ...defaultDevelop(), exposure: 0.7, crop: { ...defaultDevelop().crop, w: 0.5, x: 0.25 } }
    const bw = BUILTIN_PRESETS.find((p) => p.id === 'bw')!
    const next = applyPreset(current, { ...bw.develop, crop: defaultDevelop().crop })
    expect(next.mono).toBe(true)
    expect(next.exposure).toBe(0.7)
    expect(next.crop.w).toBe(0.5)
  })

  it('every built-in preset yields a valid catalog entry', () => {
    const catalog = emptyCatalog()
    for (const p of BUILTIN_PRESETS) {
      catalog.photos.push({
        id: p.id,
        path: 'C:/p.jpg',
        preview: '',
        name: 'p.jpg',
        width: 10,
        height: 10,
        addedAt: 0,
        rating: 0,
        flag: 'none',
        develop: applyPreset(defaultDevelop(), p.develop),
        copyOf: '',
        snapshots: []
      })
    }
    expect(PhotoCatalog.safeParse(catalog).success).toBe(true)
  })

  it('develop keys change with the settings', () => {
    expect(isDefaultDevelop(defaultDevelop())).toBe(true)
    expect(developKey(defaultDevelop())).toBe(developKey(defaultDevelop()))
    expect(developKey({ ...defaultDevelop(), exposure: 0.1 })).not.toBe(developKey(defaultDevelop()))
  })
})

describe('auto tone', () => {
  const image = (fn: (i: number) => number) => {
    const px = new Uint8ClampedArray(64 * 64 * 4)
    for (let i = 0; i < 64 * 64; i++) {
      const v = fn(i)
      px.set([v, v, v, 255], i * 4)
    }
    return px
  }

  it('brightens a dark photo and darkens a bright one', () => {
    expect(autoTone(image((i) => 20 + (i % 40))).exposure!).toBeGreaterThan(0.5)
    expect(autoTone(image((i) => 200 + (i % 50))).exposure!).toBeLessThan(-0.3)
  })

  it('stretches a flat photo to full range', () => {
    const flat = autoTone(image((i) => 90 + (i % 60)))
    expect(flat.whites!).toBeGreaterThan(0.5)
    expect(flat.blacks!).toBeLessThan(-0.5)
    expect(flat.contrast!).toBeGreaterThan(0)
  })
})

describe('photo catalog schema', () => {
  it('accepts turned crops whose unturned box reaches past the edges, and 150 % sharpening', () => {
    const develop = { ...defaultDevelop(), sharpen: { amount: 1.5, radius: 1, masking: 0 } }
    develop.crop = fitCrop({ x: -0.0000001, y: 0, w: 0.2, h: 0.95, angle: 40, aspect: 'free' }, W, H)
    const catalog = emptyCatalog()
    catalog.photos.push({ id: 'a', path: 'C:/a.jpg', preview: '', name: 'a.jpg', width: W, height: H, addedAt: 0, rating: 0, flag: 'none', develop, copyOf: '', snapshots: [] })
    expect(PhotoCatalog.safeParse(catalog).success).toBe(true)
  })
})

const photoOf = (id: string, name: string, rating: number, develop = defaultDevelop()): Photo => ({
  id,
  path: `C:/${name}`,
  preview: '',
  name,
  width: W,
  height: H,
  addedAt: 0,
  rating,
  flag: 'none',
  develop,
  copyOf: '',
  snapshots: []
})

describe('photo catalog upgrade', () => {
  it('opens a version 1 catalog with the new settings filled in', () => {
    const v1 = emptyCatalog() as unknown as { version: number; photos: unknown[] }
    const { lens: _l, transform: _t, masks: _m, ...oldDevelop } = defaultDevelop()
    const { snapshots: _s, ...oldPhoto } = photoOf('a', 'a.jpg', 3, { ...defaultDevelop(), exposure: 0.4 })
    v1.version = 1
    v1.photos = [{ ...oldPhoto, develop: { ...oldDevelop, exposure: 0.4 } }]
    const parsed = PhotoCatalog.safeParse(upgradeCatalog(v1))
    expect(parsed.success).toBe(true)
    const p = parsed.data!.photos[0]
    expect(p.develop.exposure).toBe(0.4)
    expect(p.develop.masks).toEqual([])
    expect(p.develop.lens.distortion).toBe(0)
    expect(p.snapshots).toEqual([])
  })

  it('keeps masks valid in the catalog and away from presets', () => {
    const develop = { ...defaultDevelop(), masks: [newMask('radial', 'r'), newMask('linear', 'l'), newMask('brush', 'b')] }
    const catalog = emptyCatalog()
    catalog.photos.push(photoOf('a', 'a.jpg', 0, develop))
    expect(PhotoCatalog.safeParse(catalog).success).toBe(true)
    // A preset (or pasted settings) never replaces the photo's own masks.
    expect(applyPreset(develop, { ...defaultDevelop(), exposure: 1 }).masks).toHaveLength(3)
  })
})

describe('local masks', () => {
  const radial = newMask('radial', 'r') as Extract<PhotoMask, { kind: 'radial' }>
  const linear = newMask('linear', 'l') as Extract<PhotoMask, { kind: 'linear' }>

  it('radial: full inside, none outside, soft in between', () => {
    expect(radialWeight(radial, 0.5, 0.5, W, H)).toBe(1)
    expect(radialWeight(radial, 0.02, 0.02, W, H)).toBe(0)
    const edge = radialWeight(radial, 0.5 + (radial.rx * 0.9 * Math.max(W, H)) / W, 0.5, W, H)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(1)
    // Turning a circle-like ellipse by 90° swaps its axes.
    const turned = { ...radial, angle: 90 }
    const px = 0.5 + (radial.rx * 0.8 * Math.max(W, H)) / W
    expect(radialWeight(turned, px, 0.5, W, H)).toBeLessThan(radialWeight(radial, px, 0.5, W, H))
  })

  it('linear: full before the first point, none after the second', () => {
    expect(linearWeight(linear, 0.5, 0.05, W, H)).toBe(1)
    expect(linearWeight(linear, 0.5, 0.9, W, H)).toBe(0)
    expect(linearWeight(linear, 0.5, 0.35, W, H)).toBeCloseTo(0.5, 1)
  })

  it('brush strokes paint, erase, and grow incrementally to the same image', () => {
    const { w, h } = maskSize(W, H, 120)
    expect([w, h]).toEqual([120, 80])
    const stroke = { size: 0.05, feather: 0.3, erase: false, points: [0.2, 0.5, 0.5, 0.5] }
    const brush: PhotoMask = { ...newMask('brush', 'b'), kind: 'brush', strokes: [stroke] }
    const img = rasterMask(brush, w, h)
    expect(img[Math.round(0.5 * h) * w + Math.round(0.35 * w)]).toBe(255)
    expect(img[Math.round(0.1 * h) * w + Math.round(0.9 * w)]).toBe(0)
    const erased = rasterMask({ ...brush, strokes: [stroke, { ...stroke, erase: true, points: [0.35, 0.5] }] }, w, h)
    expect(erased[Math.round(0.5 * h) * w + Math.round(0.35 * w)]).toBe(0)

    const cache = new MaskRaster()
    const a = cache.get(brush, w, h)
    expect(a.changed).toBe(true)
    expect(cache.get({ ...brush, invert: true }, w, h).changed).toBe(false)
    const longer: PhotoMask = { ...brush, strokes: [{ ...stroke, points: [...stroke.points, 0.8, 0.3] }, { ...stroke, erase: true, points: [0.25, 0.5] }] }
    const b = cache.get(longer, w, h)
    expect(b.changed).toBe(true)
    expect([...b.data]).toEqual([...rasterMask(longer, w, h)])
  })

  it('screen ↔ photo mapping round-trips through a turned crop and a zoom window', () => {
    const crop = fitCrop({ x: 0.1, y: 0.2, w: 0.6, h: 0.5, angle: 12, aspect: 'free' }, W, H)
    const view = zoomView(0.3, 0.7, 0.25, 0.25)
    const [x, y] = viewToFrame(0.4, 0.6, crop, view, W, H)
    const [u, v] = frameToView(x, y, crop, view, W, H)
    expect(u).toBeCloseTo(0.4, 6)
    expect(v).toBeCloseTo(0.6, 6)
    // The window never leaves the crop.
    expect(zoomView(0.99, 0.01, 0.3, 0.3)).toEqual({ x: 0.7, y: 0, w: 0.3, h: 0.3 })
  })
})

describe('library and export helpers', () => {
  it('sorts by name and rating, keeping catalog order otherwise', () => {
    const catalog = emptyCatalog()
    catalog.photos.push(photoOf('1', 'IMG_10.jpg', 2), photoOf('2', 'IMG_9.jpg', 5), photoOf('3', 'IMG_2.jpg', 2))
    const base = { catalog, minRating: 0, flagFilter: 'all' as const }
    expect(visiblePhotos({ ...base, sort: 'added' }).map((p) => p.id)).toEqual(['1', '2', '3'])
    expect(visiblePhotos({ ...base, sort: 'name' }).map((p) => p.id)).toEqual(['3', '2', '1'])
    expect(visiblePhotos({ ...base, sort: 'rating' }).map((p) => p.id)).toEqual(['2', '1', '3'])
  })

  it('names exported files after the original or a numbered custom name', () => {
    expect(exportName('Tatil.JPG', 0, '')).toBe('Tatil')
    expect(exportName('Tatil.JPG', 11, ' Düğün ')).toBe('Düğün-012')
  })
})
