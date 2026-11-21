import { Flag, FlagOff, Star } from 'lucide-react'
import type { PhotoFlag } from '@shared/photo'
import { useT } from '@renderer/i18n'
import s from './photos.module.css'

/** Five clickable stars; clicking the current rating clears it. */
export function Stars({ value, onChange, small }: { value: number; onChange(v: number): void; small?: boolean }) {
  const t = useT()
  return (
    <span className={s.stars} data-small={small} role="radiogroup" aria-label={t('photo.rating')}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={t('photo.stars', { n })}
          className={s.star}
          data-on={n <= value}
          onClick={(e) => {
            e.stopPropagation()
            onChange(value === n ? 0 : n)
          }}
        >
          <Star />
        </button>
      ))}
    </span>
  )
}

export function FlagIcon({ flag }: { flag: PhotoFlag }) {
  if (flag === 'pick') return <Flag className={s.flagPick} />
  if (flag === 'reject') return <FlagOff className={s.flagReject} />
  return null
}
