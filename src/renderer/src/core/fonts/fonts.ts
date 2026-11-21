import { create } from 'zustand'
import type { CustomFont } from '@shared/api'
import { api, log, mediaUrl } from '@renderer/lib/api'
import './bundled'

/**
 * Fonts available to text clips: fonts that ship inside Maker (always identical in preview and
 * export), fonts installed on this computer, and font files the user added.
 */

export interface BundledFont {
  family: string
  label: string
}

/** Bundled fonts (Turkish glyphs included). Variable fonts support every weight. */
export const BUNDLED_FONTS: BundledFont[] = [
  { family: 'Inter Variable', label: 'Inter' },
  { family: 'Montserrat Variable', label: 'Montserrat' },
  { family: 'Poppins', label: 'Poppins' },
  { family: 'Roboto Variable', label: 'Roboto' },
  { family: 'Open Sans Variable', label: 'Open Sans' },
  { family: 'Lato', label: 'Lato' },
  { family: 'Nunito Variable', label: 'Nunito' },
  { family: 'Rubik Variable', label: 'Rubik' },
  { family: 'Raleway Variable', label: 'Raleway' },
  { family: 'Space Grotesk Variable', label: 'Space Grotesk' },
  { family: 'Oswald Variable', label: 'Oswald' },
  { family: 'Bebas Neue', label: 'Bebas Neue' },
  { family: 'Anton', label: 'Anton' },
  { family: 'Archivo Black', label: 'Archivo Black' },
  { family: 'Bangers', label: 'Bangers' },
  { family: 'Luckiest Guy', label: 'Luckiest Guy' },
  { family: 'Righteous', label: 'Righteous' },
  { family: 'Fredoka Variable', label: 'Fredoka' },
  { family: 'Playfair Display Variable', label: 'Playfair Display' },
  { family: 'Abril Fatface', label: 'Abril Fatface' },
  { family: 'Lobster', label: 'Lobster' },
  { family: 'Pacifico', label: 'Pacifico' },
  { family: 'Dancing Script Variable', label: 'Dancing Script' },
  { family: 'Caveat Variable', label: 'Caveat' }
]

/** Shown until (or if) the system font list cannot be read: fonts every Windows has. */
const WINDOWS_FONTS = ['Segoe UI', 'Bahnschrift', 'Arial', 'Arial Black', 'Impact', 'Georgia', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Consolas', 'Comic Sans MS', 'Segoe UI Emoji']

interface FontState {
  system: string[]
  systemLoaded: boolean
  custom: CustomFont[]
}

export const useFonts = create<FontState>(() => ({ system: WINDOWS_FONTS, systemLoaded: false, custom: [] }))

const registered = new Set<string>()

/** Makes user font files usable by canvas text (in the editor and in the export window). */
export async function registerFontFiles(fonts: CustomFont[]) {
  await Promise.all(
    fonts.map(async (f) => {
      if (registered.has(f.path)) return
      try {
        const face = new FontFace(f.family, `url("${mediaUrl(f.path)}")`)
        document.fonts.add(await face.load())
        registered.add(f.path)
      } catch (err) {
        log.warn('fonts', `could not load ${f.path}: ${String(err)}`)
      }
    })
  )
}

export const fontActions = {
  async loadCustom() {
    const custom = await api.fonts.list()
    await registerFontFiles(custom)
    useFonts.setState({ custom })
  },
  /** Reads installed font families (Local Font Access); keeps the default list if refused. */
  async loadSystem() {
    if (useFonts.getState().systemLoaded) return
    try {
      const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts
      if (!query) return
      const families = [...new Set((await query()).map((f) => f.family))].sort((a, b) => a.localeCompare(b))
      if (families.length) useFonts.setState({ system: families, systemLoaded: true })
    } catch (err) {
      log.warn('fonts', `system fonts unavailable: ${String(err)}`)
    }
  },
  async import(): Promise<CustomFont[]> {
    const added = await api.fonts.import()
    if (added.length) await fontActions.loadCustom()
    return added
  },
  async remove(path: string) {
    await api.fonts.remove(path)
    useFonts.setState((s) => ({ custom: s.custom.filter((f) => f.path !== path) }))
  }
}

/** Display name of a font family. */
export const fontLabel = (family: string) => BUNDLED_FONTS.find((f) => f.family === family)?.label ?? family
