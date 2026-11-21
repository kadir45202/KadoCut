import type { TextStyle } from '@shared/project/schema'
import { captionTextStyle } from '@shared/project/defaults'

/** Built-in caption looks. Custom looks the user saves live in settings.captions.styles. */
export const BUILTIN_STYLES = {
  bold: () => captionTextStyle(),
  box: () => ({ ...captionTextStyle(), strokeWidth: 0, shadow: true, highlightMode: 'box', highlightColor: '#5E5CE6' }),
  pop: () => ({ ...captionTextStyle(), fontSize: 0.052, fontWeight: 900, strokeWidth: 0.16, highlightMode: 'scale', highlightColor: '#30D158' }),
  reveal: () => ({ ...captionTextStyle(), reveal: 'word', highlightColor: '#FFFFFF' }),
  boxed: () => ({ ...captionTextStyle(), uppercase: false, strokeWidth: 0, backgroundOpacity: 0.7, shadow: false, highlightColor: '#64D2FF' }),
  clean: () => ({ ...captionTextStyle(), uppercase: false, strokeWidth: 0, fontWeight: 600, highlightColor: '#FFFFFF' }),
  impact: () => ({ ...captionTextStyle(), fontFamily: 'Impact', fontWeight: 400, fontSize: 0.05, strokeWidth: 0.1, highlightMode: 'scale', highlightColor: '#FF453A' }),
  subtitle: () => ({ ...captionTextStyle(), uppercase: false, fontWeight: 600, fontSize: 0.03, strokeWidth: 0, backgroundOpacity: 0.55, shadow: false, highlightMode: 'none', maxWidth: 0.9 })
} satisfies Record<string, () => TextStyle>

export type BuiltinStyleId = keyof typeof BUILTIN_STYLES
export const BUILTIN_IDS = Object.keys(BUILTIN_STYLES) as BuiltinStyleId[]
