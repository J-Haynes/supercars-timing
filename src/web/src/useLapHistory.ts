import { useEffect, useState } from 'react'
import type { LapHistory } from './types'

/** How often the charts refresh their lap history. Laps take ~2 minutes at Bathurst, so this is plenty. */
const REFRESH_MS = 10_000

/**
 * Per-car lap history: live from GET /api/laps, refreshed every few seconds (kept out of the live snapshot because
 * it's large), or once from a recorded session's /api/sessions/{id}/laps. Null until loaded, or when the server is
 * too old to have the endpoint.
 */
export function useLapHistory(session: string, { url = '/api/laps', live = true, enabled = true } = {}): LapHistory | null {
  const [history, setHistory] = useState<LapHistory | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(url)
        if (!res.ok) return
        const data = (await res.json()) as LapHistory
        if (!cancelled) setHistory(data)
      } catch {
        /* offline or no endpoint yet: keep what we have */
      }
    }
    load()
    // A recorded session's laps don't change: load once.
    const id = live ? window.setInterval(load, REFRESH_MS) : 0
    return () => { cancelled = true; window.clearInterval(id) }
  }, [session, url, live, enabled])
  return history
}
