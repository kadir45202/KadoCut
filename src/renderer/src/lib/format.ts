/** 00:00:00:00 style timecode (frames). */
export function timecode(seconds: number, fps: number): string {
  const total = Math.max(0, Math.round(seconds * fps))
  const f = total % Math.round(fps)
  const s = Math.floor(total / Math.round(fps))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`
}

/** m:ss or h:mm:ss for durations. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Short duration with tenths for clip labels: 3.4s */
export function shortDuration(seconds: number): string {
  return seconds < 60 ? `${seconds.toFixed(1)}s` : duration(seconds)
}

export function bytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / 1024 / 1024)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function relativeTime(timestamp: number, lang: string): string {
  const diff = (timestamp - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
  return new Date(timestamp).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })
}

export const gainToDb = (g: number) => (g <= 0.0001 ? -Infinity : 20 * Math.log10(g))
export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20))
