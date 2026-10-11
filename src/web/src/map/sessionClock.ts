/**
 * The session clock between server updates, as plain functions (used by useSessionClock and by test scripts).
 *
 * Server updates carry the Natsoft time of the latest message; between them we extrapolate at `rate`. When an update
 * shows we're behind, the correction is blended in over `CATCH_UP` seconds instead of jumping: a jump moved every
 * car on the map forward by a few metres at once. The clock never goes backwards; a big difference (a new session,
 * a replay restarting, a reconnect) snaps straight there.
 *
 * A clock that ends up well ahead of the server slows down (to MIN_RATE of its speed) until it's back in line, rather
 * than staying ahead. That happened with a broadcast delay: while the delay buffer fills, the shown update stands
 * still but the clock ran on, so it stayed ~5 s ahead of the delayed data for good (the map then guessed at a time
 * the live feed hadn't reached, and pit timers were 5 s out). Small leads are normal: F1 sends timing in bursts up
 * to ~2 s apart, stamped with when each message was made.
 */
export interface ClockAnchor {
  time: number
  /** performance.now() when anchored, in ms. */
  at: number
  rate: number
  /** Seconds still to blend in, fading in from `at`. */
  correction: number
  /** Time constant for blending the correction in (CATCH_UP unless the clock is slowing down). */
  blend?: number
  /** Slowing down to get back in line with the server (until within SETTLED). */
  pulling?: boolean
}

const CATCH_UP = 0.5
const SNAP_AHEAD = 2
const SNAP_BEHIND = 5
/** Ahead of the server by more than this: slow down until within SETTLED. F1's bursts leave the clock up to ~2 s ahead. */
const PULL_BACK = 2.5
const SETTLED = 0.3
const MIN_RATE = 0.3

export function clockAt(a: ClockAnchor, wallMs: number): number {
  const s = Math.max(0, (wallMs - a.at) / 1000)
  return a.time + s * a.rate + a.correction * (1 - Math.exp(-s / (a.blend ?? CATCH_UP)))
}

export function anchorClock(prev: ClockAnchor | null, serverNow: number, rate: number, wallMs: number): ClockAnchor {
  if (!prev) return { time: serverNow, at: wallMs, rate, correction: 0 }
  const current = clockAt(prev, wallMs)
  const diff = serverNow - current
  if (diff > SNAP_AHEAD || diff < -SNAP_BEHIND || (diff < -PULL_BACK && rate <= 0)) return { time: serverNow, at: wallMs, rate, correction: 0 }
  // Well ahead: blend the (negative) correction in slowly enough that the clock still moves forward at MIN_RATE.
  if (diff < -PULL_BACK || (prev.pulling && diff < -SETTLED)) {
    return { time: current, at: wallMs, rate, correction: diff, blend: -diff / ((1 - MIN_RATE) * rate), pulling: true }
  }
  return { time: current, at: wallMs, rate, correction: Math.max(0, diff) }
}
