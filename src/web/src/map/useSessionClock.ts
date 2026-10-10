import { useEffect, useRef, useState } from 'react'

/**
 * Estimates the current Natsoft session time between server updates, ticking every animation frame.
 *
 * `serverNow` is the timestamp of the latest message, so the real time is always at or after it.
 * We extrapolate at `rate` (replay speed) and only ever move forward, except for a big backwards jump,
 * which means a new session or a replay restarting.
 */
export function useSessionClock(serverNow: number, rate: number): number {
  const anchor = useRef({ time: serverNow, at: performance.now(), rate })
  const [now, setNow] = useState(serverNow)

  useEffect(() => {
    const a = anchor.current
    const predicted = a.time + ((performance.now() - a.at) / 1000) * a.rate
    const time = serverNow > predicted || serverNow < predicted - 5 ? serverNow : predicted
    anchor.current = { time, at: performance.now(), rate }
  }, [serverNow, rate])

  useEffect(() => {
    let frame = 0
    const tick = () => {
      const a = anchor.current
      setNow(a.time + ((performance.now() - a.at) / 1000) * a.rate)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return now
}
