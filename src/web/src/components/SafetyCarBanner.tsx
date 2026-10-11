import { useRef } from 'react'
import type { TimingSnapshot } from '../types'
import { cautionPeriods, flagKind } from '../session'
import { clock } from '../format'

/**
 * Banner above the race tower while a safety car / full-course yellow is out: how long it's been out, laps under it
 * (counted from when this page saw it start), which caution of the race it is, and who has pitted under it.
 */
export function SafetyCarBanner({ timing }: { timing: TimingSnapshot }) {
  const kind = flagKind(timing.session.flag)
  const periods = cautionPeriods(timing.flagHistory)
  const current = periods.length > 0 && periods[periods.length - 1].end === undefined ? periods[periods.length - 1] : undefined
  const leaderLaps = Math.max(0, ...timing.cars.map((c) => c.laps))
  // Laps under the caution: the leader's laps when we first saw it. Lost on a page refresh mid-caution (then hidden).
  const startLaps = useRef<{ start: number; laps: number } | null>(null)
  if (current && startLaps.current?.start !== current.start) {
    startLaps.current = { start: current.start, laps: timing.now - current.start < 5 ? leaderLaps : -1 }
  }
  if (kind !== 'caution' && kind !== 'red') return null

  const since = current ? clock(Math.max(0, Math.floor(timing.now - current.start))) : null
  const laps = startLaps.current && startLaps.current.laps >= 0 ? leaderLaps - startLaps.current.laps : null
  const pitted = current
    ? timing.cars.filter((c) => (c.pitLog ?? []).some((p) => p.inAt >= current.start)).map((c) => `#${c.carNumber}`)
    : []

  return (
    <div className={`sc-banner ${kind}`} role="status">
      <strong>{kind === 'red' ? 'Red flag' : 'Safety car / full course yellow'}</strong>
      {since && <span>out for {since}</span>}
      {laps !== null && <span>{laps} {laps === 1 ? 'lap' : 'laps'} under caution</span>}
      {kind === 'caution' && periods.length > 0 && <span>caution #{periods.length} today</span>}
      {pitted.length > 0 && <span>pitted under it: {pitted.join(', ')}</span>}
    </div>
  )
}
