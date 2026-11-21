import { LayoutGrid } from 'lucide-react'
import type { Settings } from '@shared/settings'
import { settingsActions, useSettings } from '@renderer/core/store/settings'
import { useT } from '@renderer/i18n'
import { IconButton, Segmented, Switch } from '@renderer/ui/controls'
import { Popover } from '@renderer/ui/overlays'
import s from './editor.module.css'

type SafeZone = Settings['viewer']['safeZone']
type Area = 'top' | 'caption' | 'buttons'

/**
 * Approximate regions covered by each platform's interface on a 9:16 video (fractions of the
 * frame). Keep titles and faces out of them.
 */
const SAFE_ZONES: Record<Exclude<SafeZone, 'none'>, { area: Area; x: number; y: number; w: number; h: number }[]> = {
  reels: [
    { area: 'top', x: 0, y: 0, w: 1, h: 0.11 },
    { area: 'caption', x: 0, y: 0.8, w: 1, h: 0.2 },
    { area: 'buttons', x: 0.86, y: 0.42, w: 0.14, h: 0.38 }
  ],
  tiktok: [
    { area: 'top', x: 0, y: 0, w: 1, h: 0.08 },
    { area: 'caption', x: 0, y: 0.79, w: 1, h: 0.21 },
    { area: 'buttons', x: 0.85, y: 0.38, w: 0.15, h: 0.41 }
  ],
  shorts: [
    { area: 'top', x: 0, y: 0, w: 1, h: 0.09 },
    { area: 'caption', x: 0, y: 0.8, w: 1, h: 0.2 },
    { area: 'buttons', x: 0.84, y: 0.45, w: 0.16, h: 0.35 }
  ]
}

/** Thirds grid, centre cross and platform safe zones drawn over the picture. */
export function GuidesOverlay({ width, height }: { width: number; height: number }) {
  const t = useT()
  const viewer = useSettings((st) => st.settings.viewer)
  if (!width || !height || (!viewer.grid && viewer.safeZone === 'none')) return null
  const zones = viewer.safeZone === 'none' ? [] : SAFE_ZONES[viewer.safeZone]
  return (
    <svg className={s.guides} width={width} height={height} data-testid="guides">
      <defs>
        <pattern id="safe-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="8" height="8" fill="rgba(255, 69, 58, 0.16)" />
          <line x1="0" y1="0" x2="0" y2="8" stroke="rgba(255, 69, 58, 0.35)" strokeWidth="2" />
        </pattern>
      </defs>
      {zones.map((z) => (
        <g key={z.area}>
          <rect x={z.x * width} y={z.y * height} width={z.w * width} height={z.h * height} fill="url(#safe-hatch)" />
          <text
            x={(z.x + z.w / 2) * width}
            y={(z.y + z.h / 2) * height}
            className={s.guideLabel}
            // Narrow side columns get a vertical label.
            transform={z.w * width < 80 ? `rotate(90 ${(z.x + z.w / 2) * width} ${(z.y + z.h / 2) * height})` : undefined}
          >
            {t(`viewer.safe.${z.area}`)}
          </text>
        </g>
      ))}
      {viewer.grid && (
        <g className={s.guideGrid}>
          {[1 / 3, 2 / 3].map((f) => (
            <g key={f}>
              <line x1={f * width} y1={0} x2={f * width} y2={height} />
              <line x1={0} y1={f * height} x2={width} y2={f * height} />
            </g>
          ))}
          <line x1={width / 2 - 10} y1={height / 2} x2={width / 2 + 10} y2={height / 2} />
          <line x1={width / 2} y1={height / 2 - 10} x2={width / 2} y2={height / 2 + 10} />
        </g>
      )}
    </svg>
  )
}

/** Transport-bar popover that toggles the viewer overlays. */
export function GuidesMenu() {
  const t = useT()
  const viewer = useSettings((st) => st.settings.viewer)
  const set = (patch: Partial<Settings['viewer']>) => void settingsActions.update({ viewer: { ...viewer, ...patch } })
  const active = viewer.grid || viewer.scopes || viewer.safeZone !== 'none'
  return (
    <Popover
      align="end"
      trigger={
        <IconButton label={t('viewer.guides')} active={active}>
          <LayoutGrid />
        </IconButton>
      }
    >
      <div className={s.guidesMenu}>
        <span className={s.guidesTitle}>{t('viewer.safeZone')}</span>
        <Segmented<SafeZone>
          value={viewer.safeZone}
          onChange={(safeZone) => set({ safeZone })}
          options={[
            { value: 'none', label: t('viewer.safeNone') },
            { value: 'reels', label: 'Reels' },
            { value: 'tiktok', label: 'TikTok' },
            { value: 'shorts', label: 'Shorts' }
          ]}
        />
        <span className={s.guidesHint}>{t('viewer.safeHint')}</span>
        <div className={s.guidesRow}>
          <span>{t('viewer.grid')}</span>
          <Switch checked={viewer.grid} label={t('viewer.grid')} onChange={(grid) => set({ grid })} />
        </div>
        <div className={s.guidesRow}>
          <span>{t('viewer.scopes')}</span>
          <Switch checked={viewer.scopes} label={t('viewer.scopes')} onChange={(scopes) => set({ scopes })} />
        </div>
      </div>
    </Popover>
  )
}
