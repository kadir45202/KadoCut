import type { ClipAnimation, Project, ShapeClip, TextClip, TextStyle } from '@shared/project/schema'
import { defaultAnim, defaultTextStyle, defaultTransform } from '@shared/project/defaults'
import { shapeClip, textClip } from '@renderer/core/project/factory'
import { addTrack } from '@renderer/core/project/timeline'

/**
 * Title templates: ready-made text (and backing shapes) with fonts, colours and motion. Each
 * element gets its own track, bottom to top, so backgrounds stay under their text.
 */

type Anim = Partial<{ in: ClipAnimation['in']; out: ClipAnimation['out']; loop: ClipAnimation['loop'] }>

interface TextPart {
  kind: 'text'
  /** Key into the template strings (sample text the user replaces). */
  text: string
  style: Partial<TextStyle>
  x?: number
  y?: number
  anim?: Anim
}

interface ShapePart {
  kind: 'shape'
  shape: ShapeClip['shape']
  width: number
  height: number
  fill: string
  radius?: number
  opacity?: number
  x?: number
  y?: number
  anim?: Anim
}

export interface TitleTemplate {
  id: 'lowerThird' | 'bigTitle' | 'quote' | 'chapter' | 'news' | 'tag' | 'cinematic' | 'handwritten' | 'question'
  duration: number
  parts: (TextPart | ShapePart)[]
}

const fade = (d = 0.4) => ({ type: 'fade' as const, duration: d })

export const TITLE_TEMPLATES: TitleTemplate[] = [
  {
    id: 'lowerThird',
    duration: 4,
    parts: [
      { kind: 'shape', shape: 'rectangle', width: 0.8, height: 0.105, fill: '#000000', radius: 0.25, opacity: 0.6, y: 0.3, anim: { in: { type: 'slideUp', duration: 0.4 }, out: fade() } },
      { kind: 'text', text: 'lowerThird.name', style: { fontFamily: 'Montserrat Variable', fontWeight: 800, fontSize: 0.036, shadow: false }, y: 0.287, anim: { in: { type: 'slideUp', duration: 0.5 }, out: fade() } },
      { kind: 'text', text: 'lowerThird.role', style: { fontFamily: 'Montserrat Variable', fontWeight: 600, fontSize: 0.022, color: '#FFD60A', letterSpacing: 0.08, uppercase: true, shadow: false }, y: 0.318, anim: { in: { type: 'slideUp', duration: 0.6 }, out: fade() } }
    ]
  },
  {
    id: 'bigTitle',
    duration: 3,
    parts: [
      { kind: 'text', text: 'bigTitle.text', style: { fontFamily: 'Anton', fontWeight: 400, fontSize: 0.1, uppercase: true, strokeWidth: 0.06, strokeColor: '#000000', maxWidth: 0.9 }, anim: { in: { type: 'pop', duration: 0.35 }, out: { type: 'zoomOut', duration: 0.3 } } }
    ]
  },
  {
    id: 'quote',
    duration: 5,
    parts: [
      { kind: 'text', text: 'quote.text', style: { fontFamily: 'Playfair Display Variable', fontWeight: 600, fontSize: 0.048, lineHeight: 1.25, maxWidth: 0.8, shadow: true }, y: -0.03, anim: { in: { type: 'typewriter', duration: 1.6 }, out: fade() } },
      { kind: 'shape', shape: 'line', width: 0.12, height: 0.003, fill: '#FFD60A', y: 0.07, anim: { in: fade(0.8), out: fade() } },
      { kind: 'text', text: 'quote.author', style: { fontFamily: 'Montserrat Variable', fontWeight: 500, fontSize: 0.026, letterSpacing: 0.1, uppercase: true, color: '#FFD60A', shadow: false }, y: 0.1, anim: { in: fade(0.8), out: fade() } }
    ]
  },
  {
    id: 'chapter',
    duration: 3,
    parts: [
      { kind: 'text', text: 'chapter.number', style: { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 0.14, color: '#FF9F0A', shadow: false }, y: -0.06, anim: { in: { type: 'slideUp', duration: 0.45 }, out: fade() } },
      { kind: 'text', text: 'chapter.title', style: { fontFamily: 'Montserrat Variable', fontWeight: 700, fontSize: 0.042, uppercase: true, letterSpacing: 0.06 }, y: 0.03, anim: { in: { type: 'slideUp', duration: 0.6 }, out: fade() } }
    ]
  },
  {
    id: 'news',
    duration: 4,
    parts: [
      { kind: 'shape', shape: 'rectangle', width: 1, height: 0.06, fill: '#FF3B30', radius: 0, y: 0.32, anim: { in: { type: 'slideRight', duration: 0.35 }, out: fade() } },
      { kind: 'text', text: 'news.text', style: { fontFamily: 'Archivo Black', fontWeight: 400, fontSize: 0.03, uppercase: true, shadow: false, maxWidth: 0.95 }, y: 0.32, anim: { in: { type: 'slideRight', duration: 0.5 }, out: fade() } }
    ]
  },
  {
    id: 'tag',
    duration: 3,
    parts: [
      { kind: 'text', text: 'tag.text', style: { fontFamily: 'Poppins', fontWeight: 800, fontSize: 0.04, color: '#000000', backgroundColor: '#FFD60A', backgroundOpacity: 1, shadow: false }, anim: { in: { type: 'pop', duration: 0.3 }, loop: { type: 'wiggle', period: 1.6 }, out: { type: 'pop', duration: 0.25 } } }
    ]
  },
  {
    id: 'cinematic',
    duration: 4,
    parts: [
      { kind: 'text', text: 'cinematic.text', style: { fontFamily: 'Montserrat Variable', fontWeight: 300, fontSize: 0.034, uppercase: true, letterSpacing: 0.45, shadow: false }, anim: { in: fade(1), out: fade(1) } }
    ]
  },
  {
    id: 'handwritten',
    duration: 4,
    parts: [
      { kind: 'text', text: 'handwritten.text', style: { fontFamily: 'Caveat Variable', fontWeight: 700, fontSize: 0.08, color: '#FFFFFF', shadow: true }, anim: { in: { type: 'typewriter', duration: 1.2 }, out: fade() } }
    ]
  },
  {
    id: 'question',
    duration: 4,
    parts: [
      { kind: 'shape', shape: 'rectangle', width: 0.72, height: 0.11, fill: '#FFFFFF', radius: 0.35, y: -0.1, anim: { in: { type: 'pop', duration: 0.35 }, out: fade() } },
      { kind: 'text', text: 'question.text', style: { fontFamily: 'Poppins', fontWeight: 700, fontSize: 0.034, color: '#1C1C1E', shadow: false, maxWidth: 0.62 }, y: -0.1, anim: { in: { type: 'pop', duration: 0.4 }, out: fade() } }
    ]
  }
]

const withAnim = (anim: Anim | undefined): ClipAnimation => ({ ...defaultAnim(), ...anim })

/** Adds a template's clips at `start` on fresh tracks; returns the new clip ids. */
export function placeTemplate(draft: Project, tpl: TitleTemplate, start: number, text: (key: string) => string): string[] {
  const ids: string[] = []
  for (const part of tpl.parts) {
    const track = addTrack(draft, 'text')
    let clip: TextClip | ShapeClip
    if (part.kind === 'text') {
      const tc = textClip(track.id, start, text(part.text))
      tc.style = { ...defaultTextStyle(), ...part.style }
      clip = tc
    } else {
      const sc = shapeClip(track.id, start, part.shape, draft.settings)
      Object.assign(sc, { width: part.width, height: part.height, fill: part.fill, radius: part.radius ?? sc.radius, strokeWidth: 0, name: text(`template.${tpl.id}`) })
      clip = sc
    }
    clip.duration = tpl.duration
    clip.transform = {
      ...defaultTransform(),
      x: { value: part.x ?? 0, keys: [] },
      y: { value: part.y ?? 0, keys: [] },
      opacity: { value: part.kind === 'shape' ? (part.opacity ?? 1) : 1, keys: [] }
    }
    clip.anim = withAnim(part.anim)
    draft.clips[clip.id] = clip
    ids.push(clip.id)
  }
  return ids
}
