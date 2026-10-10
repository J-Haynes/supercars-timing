import { useEffect, useRef, useState } from 'react'
import type { TimingUpdate } from './types'

/** Longest delay the buffer supports. Streams can run a couple of minutes behind. */
export const MAX_DELAY_SECONDS = 300

/**
 * Broadcast delay: keeps a rolling buffer of updates and shows the one that arrived `delaySeconds` ago,
 * the same approach as MultiViewer and undercut-f1. Everything downstream (tower, map, clock) reads the
 * delayed update, so it all stays in sync with the TV.
 *
 * @returns the update to display, plus how many seconds of history are buffered (when that's less than
 *          the delay, we're still filling the buffer and show the oldest update we have).
 */
export function useDelayedUpdate(latest: TimingUpdate | null, delaySeconds: number) {
  const buffer = useRef<{ at: number; update: TimingUpdate }[]>([])
  const [shown, setShown] = useState<TimingUpdate | null>(latest)
  const [buffered, setBuffered] = useState(0)

  // Record every update with its arrival time, whatever the delay, so changing the delay is instant.
  useEffect(() => {
    if (latest) buffer.current.push({ at: performance.now(), update: latest })
  }, [latest])

  useEffect(() => {
    const pick = () => {
      const now = performance.now()
      const buf = buffer.current

      // Drop history we can never need, keeping one entry older than the window as the fallback.
      const oldestUseful = now - MAX_DELAY_SECONDS * 1000
      while (buf.length > 1 && buf[1].at <= oldestUseful) buf.shift()

      setBuffered(buf.length ? (now - buf[0].at) / 1000 : 0)
      if (delaySeconds <= 0) {
        setShown(buf.length ? buf[buf.length - 1].update : null)
        return
      }
      const cutoff = now - delaySeconds * 1000
      let chosen = buf[0]
      for (const entry of buf) {
        if (entry.at <= cutoff) chosen = entry
        else break
      }
      setShown(chosen?.update ?? null)
    }
    pick()
    const id = setInterval(pick, 100)
    return () => clearInterval(id)
  }, [delaySeconds])

  // With no delay, show new updates immediately rather than on the next tick.
  return { update: delaySeconds <= 0 ? latest : shown, buffered }
}
