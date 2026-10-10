/** 125.5861 -> "2:05.586"; 0 -> "" */
export function lapTime(s: number | null | undefined): string {
  if (!s || s <= 0) return ''
  const m = Math.floor(s / 60)
  const rest = (s - m * 60).toFixed(3).padStart(6, '0')
  return m > 0 ? `${m}:${rest}` : rest.replace(/^0/, '')
}

/** Sector / interval style: 51.4077 -> "51.408" */
export function seconds(s: number | null | undefined): string {
  if (!s || s <= 0) return ''
  return s.toFixed(3)
}

export function gapText(gap: number, laps: number, isFirst: boolean): string {
  if (isFirst) return 'Leader'
  if (laps > 0) return `+${laps} ${laps === 1 ? 'lap' : 'laps'}`
  return gap > 0 ? `+${gap.toFixed(3)}` : ''
}

/** 3012 -> "50:12" */
export function clock(totalSeconds: number | null): string {
  if (totalSeconds == null || totalSeconds < 0) return '--:--'
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Purple = session best, green = personal best, otherwise plain. */
export function timeClass(value: number, personalBest: number, sessionBest: number | null): string {
  if (!value || value <= 0) return ''
  if (sessionBest && Math.abs(value - sessionBest) < 0.0005) return 'session-best'
  if (personalBest && Math.abs(value - personalBest) < 0.0005) return 'personal-best'
  return ''
}
