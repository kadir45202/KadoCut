import { CircleAlert, LoaderCircle, X } from 'lucide-react'
import { useMemo } from 'react'
import { cancelJob, useJobs } from '@renderer/core/store/jobs'
import { useT } from '@renderer/i18n'
import { Popover } from '@renderer/ui/overlays'
import { Progress, spinClass } from '@renderer/ui/layout'
import s from './jobs.module.css'

/** Title-bar indicator for background work (AI tools, exports, downloads). */
export function JobsIndicator() {
  const t = useT()
  const all = useJobs((st) => st.jobs)
  // Select the raw map and derive here: zustand selectors must return stable references.
  const jobs = useMemo(() => Object.values(all).filter((j) => !j.silent).sort((a, b) => b.startedAt - a.startedAt), [all])
  const running = jobs.filter((j) => j.status === 'running')
  if (!jobs.length) return null
  const failed = jobs.some((j) => j.status === 'error' && j.error?.code !== 'cancelled')

  return (
    <Popover
      align="end"
      trigger={
        <button type="button" className={s.trigger} aria-label={t('jobs.title')}>
          {running.length ? <LoaderCircle className={spinClass} /> : failed ? <CircleAlert color="var(--danger)" /> : <LoaderCircle />}
          {running.length > 0 && <span>{running.length}</span>}
        </button>
      }
    >
      <div className={s.list}>
        <div className={s.title}>{t('jobs.title')}</div>
        {jobs.map((j) => (
          <div key={j.id} className={s.job}>
            <div className={s.jobRow}>
              <span className={s.jobLabel}>{j.label}</span>
              {j.status === 'running' && (
                <button type="button" className={s.cancel} aria-label={t('common.cancel')} onClick={() => void cancelJob(j.id)}>
                  <X />
                </button>
              )}
            </div>
            {j.status === 'running' && <Progress value={j.progress > 0 ? j.progress : null} />}
            {j.status === 'done' && <div className={s.done}>{t('jobs.done')}</div>}
            {j.status === 'error' && <div className={s.error}>{j.error?.code === 'cancelled' ? t('jobs.cancelled') : j.error?.message}</div>}
          </div>
        ))}
      </div>
    </Popover>
  )
}
