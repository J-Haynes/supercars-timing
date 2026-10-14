import type { TimingSnapshot } from '../types'
import { flagKind, isRace } from '../session'
import { useSessionClock } from '../map/useSessionClock'
import { clock } from '../format'

/** Shown from this long before the start (seconds). */
const SHOW_FROM = 60 * 60

/**
 * Countdown to a race's start, until the green flag. A replay knows the green flag's time from the recording
 * (`exact`); live timing only has the timetable's start (calendar.ts, scheduledStart), which is before the formation
 * lap, so it says "scheduled" and then waits for the green flag. Ticks with the session clock, so it runs at the
 * replay's speed and stops when paused.
 */
export function StartCountdown({ timing, clockRate, startAt, exact }: {
  timing: TimingSnapshot
  clockRate: number
  /** Session time of the start: the green flag (replay) or the timetable's start (live). */
  startAt: number | undefined
  exact: boolean
}) {
  const now = useSessionClock(timing.now, clockRate)
  const started = (timing.session.greenAt ?? 0) > 0 || flagKind(timing.session.flag) !== 'other'
  if (!isRace(timing.session.type) || started || !startAt || startAt - now > SHOW_FROM) return null
  const left = Math.ceil(startAt - now)
  // Live, once the timetable's time has passed: the formation lap and the start procedure.
  if (left <= 0 && !exact) {
    return (
      <div className="start-countdown waiting" role="status">
        <strong>Race start</strong>
        <span>scheduled for {new Date(startAt * 1000).toISOString().slice(11, 16)} track time · waiting for the green flag</span>
      </div>
    )
  }
  return (
    <div className="start-countdown" role="timer" aria-live="off">
      <strong>Race start in</strong>
      <span className="start-countdown-clock">{clock(Math.max(left, 0))}</span>
      <span className="start-countdown-note">{exact ? 'the green flag, from the recording' : 'scheduled start (timetable); the green flag follows the formation lap'}</span>
    </div>
  )
}
