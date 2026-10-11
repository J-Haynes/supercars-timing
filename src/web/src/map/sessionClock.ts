/**
 * The session clock between server updates, as plain functions (used by useSessionClock and by test scripts).
 *
 * Server updates carry the Natsoft time of the latest message; between them we extrapolate at `rate`. When an update
 * shows we're behind, the correction is blended in over `CATCH_UP` seconds instead of jumping: a jump moved every
 * car on the map forward by a few metres at once. The clock never goes backwards; a big difference (a new session,
 * a replay restarting, a reconnect) snaps straight there.
 */
export interface ClockAnchor {
  time: number
  /** performance.now() when anchored, in ms. */
  at: number
  rate: number
  /** Seconds still to blend in, fading in from `at`. */
  correction: number
}

const CATCH_UP = 0.5
const SNAP_AHEAD = 2
const SNAP_BEHIND = 5

export function clockAt(a: ClockAnchor, wallMs: number): number {
  const s = Math.max(0, (wallMs - a.at) / 1000)
  return a.time + s * a.rate + a.correction * (1 - Math.exp(-s / CATCH_UP))
}

export function anchorClock(prev: ClockAnchor | null, serverNow: number, rate: number, wallMs: number): ClockAnchor {
  if (!prev) return { time: serverNow, at: wallMs, rate, correction: 0 }
  const current = clockAt(prev, wallMs)
  const diff = serverNow - current
  if (diff > SNAP_AHEAD || diff < -SNAP_BEHIND) return { time: serverNow, at: wallMs, rate, correction: 0 }
  return { time: current, at: wallMs, rate, correction: Math.max(0, diff) }
}
