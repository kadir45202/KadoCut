import type { AspectPreset, Project, TextStyle } from '@shared/project/schema'
import { createTrack, defaultAnim, defaultTextStyle } from '@shared/project/defaults'
import { shapeClip, textClip } from '@renderer/core/project/factory'

/** Ready-made layouts (graphics only, no media) the user can start from. */
export interface BuiltinTemplate {
  id: 'reelsHook' | 'youtubeIntro' | 'quote'
  aspect: AspectPreset
  fill(p: Project, t: (key: string) => string): void
}

function addText(p: Project, trackId: string, start: number, duration: number, text: string, style: Partial<TextStyle>, y: number, anim = defaultAnim()) {
  const clip = textClip(trackId, start, text)
  clip.duration = duration
  clip.style = { ...defaultTextStyle(), ...style }
  clip.transform.y.value = y
  clip.anim = anim
  p.clips[clip.id] = clip
  return clip
}

const pop = (loop = defaultAnim().loop) => ({ ...defaultAnim(), in: { type: 'pop' as const, duration: 0.4 }, out: { type: 'fade' as const, duration: 0.3 }, loop })

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    // Hook title at the top, progress bar along the bottom, subscribe call-out at the end.
    id: 'reelsHook',
    aspect: '9:16',
    fill(p, t) {
      const titles = createTrack('tpl-title', 'text')
      const bar = createTrack('tpl-bar', 'text')
      p.tracks.push(titles, bar)
      addText(p, titles.id, 0, 3, t('tpl.hook'), { fontFamily: 'Montserrat Variable', fontWeight: 900, fontSize: 0.055, uppercase: true, strokeWidth: 0.12 }, -0.32, pop())
      addText(p, titles.id, 12, 3, t('tpl.subscribe'), { backgroundColor: '#FF3B30', backgroundOpacity: 1, fontWeight: 800, shadow: false }, 0.25, pop({ type: 'pulse', period: 1.2 }))
      const progress = shapeClip(bar.id, 0, 'progress', p.settings)
      progress.duration = 15
      p.clips[progress.id] = progress
    }
  },
  {
    id: 'youtubeIntro',
    aspect: '16:9',
    fill(p, t) {
      const track = createTrack('tpl-text', 'text')
      const line = createTrack('tpl-line', 'text')
      p.tracks.push(track, line)
      addText(p, track.id, 0, 4, t('tpl.channel'), { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 0.14, letterSpacing: 0.04 }, -0.04, {
        ...defaultAnim(),
        in: { type: 'zoomIn', duration: 0.8 },
        out: { type: 'fade', duration: 0.5 }
      })
      addText(p, track.id, 4, 2, t('tpl.episode'), { fontFamily: 'Poppins', fontWeight: 600, fontSize: 0.05 }, 0, {
        ...defaultAnim(),
        in: { type: 'slideUp', duration: 0.5 },
        out: { type: 'fade', duration: 0.4 }
      })
      const accent = shapeClip(line.id, 0.3, 'line', p.settings)
      accent.duration = 3.7
      accent.width = 0.2
      accent.transform.y.value = 0.09
      accent.anim = { ...defaultAnim(), in: { type: 'slideRight', duration: 0.6 }, out: { type: 'fade', duration: 0.5 } }
      p.clips[accent.id] = accent
    }
  },
  {
    id: 'quote',
    aspect: '1:1',
    fill(p, t) {
      const track = createTrack('tpl-text', 'text')
      p.tracks.push(track)
      p.settings.background = '#14141A'
      addText(p, track.id, 0, 6, t('tpl.quoteText'), { fontFamily: 'Playfair Display Variable', fontWeight: 600, fontSize: 0.06, maxWidth: 0.8, lineHeight: 1.25, shadow: false }, -0.05, {
        ...defaultAnim(),
        in: { type: 'typewriter', duration: 2.5 },
        out: { type: 'fade', duration: 0.6 }
      })
      addText(p, track.id, 6, 3, t('tpl.author'), { fontFamily: 'Poppins', fontWeight: 400, fontSize: 0.035, color: '#C7C7CC', shadow: false }, 0.2, {
        ...defaultAnim(),
        in: { type: 'fade', duration: 0.6 }
      })
    }
  }
]
