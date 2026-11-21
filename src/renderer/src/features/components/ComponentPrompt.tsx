import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { COMPONENTS, type ComponentId } from '@shared/components'
import { runJob, setComponentPrompt, useJobs } from '@renderer/core/store/jobs'
import { useT } from '@renderer/i18n'
import { api } from '@renderer/lib/api'
import { bytes } from '@renderer/lib/format'
import { Button } from '@renderer/ui/controls'
import { Progress } from '@renderer/ui/layout'
import { Dialog } from '@renderer/ui/overlays'

interface PromptState {
  ids: ComponentId[] | null
  resolve: ((ok: boolean) => void) | null
}

const usePrompt = create<PromptState>(() => ({ ids: null, resolve: null }))

setComponentPrompt(async (ids) => {
  const installed = new Set((await api.components.list()).filter((c) => c.installed).map((c) => c.id))
  const missing = [...new Set(ids)].filter((id) => !installed.has(id))
  if (!missing.length) return true
  return new Promise<boolean>((resolve) => usePrompt.setState({ ids: missing, resolve }))
})

/** Asks to download local AI components (Whisper, Piper, matting model) on first use. */
export function ComponentPrompt() {
  const t = useT()
  const { ids, resolve } = usePrompt()
  const [jobIds, setJobIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const jobs = useJobs((st) => st.jobs)

  useEffect(() => {
    if (ids) {
      setJobIds([])
      setError(null)
      setBusy(false)
    }
  }, [ids])

  const close = (ok: boolean) => {
    resolve?.(ok)
    usePrompt.setState({ ids: null, resolve: null })
  }

  const install = async () => {
    if (!ids) return
    setBusy(true)
    setError(null)
    try {
      for (const id of ids) {
        const promise = runJob('components.install', { id }, t('components.installing', { name: t(`component.${id}`) }))
        setJobIds((prev) => [...prev, id])
        await promise
      }
      close(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const total = (ids ?? []).reduce((sum, id) => sum + COMPONENTS[id].size, 0)
  const running = Object.values(jobs).filter((j) => j.kind === 'components.install' && j.status === 'running')
  const progress = running.length ? running.reduce((s, j) => s + j.progress, 0) / running.length : null

  return (
    <Dialog
      open={!!ids}
      onOpenChange={(o) => !o && !busy && close(false)}
      title={t('components.title')}
      description={t('components.desc', { size: bytes(total) })}
      footer={
        <>
          <Button disabled={busy} onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={busy} onClick={install}>
            {busy ? t('components.downloading') : t('components.download')}
          </Button>
        </>
      }
    >
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(ids ?? []).map((id) => (
          <li key={id}>
            {t(`component.${id}`)} <span style={{ color: 'var(--text-3)' }}>· {bytes(COMPONENTS[id].size)}</span>
            {jobIds.includes(id) && busy && running.length === 0 ? ' ✓' : ''}
          </li>
        ))}
      </ul>
      {busy && (
        <div style={{ marginTop: 14 }}>
          <Progress value={progress} />
        </div>
      )}
      {error && <p style={{ color: 'var(--danger)', marginBottom: 0 }}>{error}</p>}
    </Dialog>
  )
}
