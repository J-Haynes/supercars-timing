import { useEffect, useRef, useState } from 'react'
import { anchorClock, clockAt, type ClockAnchor } from './sessionClock'

/**
 * Estimates the current Natsoft session time between server updates, ticking every animation frame.
 *
 * `serverNow` is the timestamp of the latest message, so the real time is always at or after it. We extrapolate at
 * `rate` (replay speed) and blend corrections in smoothly (sessionClock.ts), so cars on the map don't hop forward
 * when an update arrives.
 */
export function useSessionClock(serverNow: number, rate: number): number {
  const anchor = useRef<ClockAnchor | null>(null)
  const [now, setNow] = useState(serverNow)

  useEffect(() => {
    anchor.current = anchorClock(anchor.current, serverNow, rate, performance.now())
  }, [serverNow, rate])

  useEffect(() => {
    let frame = 0
    const tick = () => {
      if (anchor.current) setNow(clockAt(anchor.current, performance.now()))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return now
}
