import { useEffect, useState } from 'react'
import type { LapHistory } from './types'

/** How often the charts refresh their lap history. Laps take ~2 minutes at Bathurst, so this is plenty. */
const REFRESH_MS = 10_000

/**
 * Per-car lap history from GET /api/laps, refreshed every few seconds. It's kept out of the live snapshot because
 * it's large. Null until loaded, or when the server is too old to have the endpoint.
 */
export function useLapHistory(session: string): LapHistory | null {
  const [history, setHistory] = useState<LapHistory | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch('/api/laps')
        if (!res.ok) return
        const data = (await res.json()) as LapHistory
        if (!cancelled) setHistory(data)
      } catch {
        /* offline or no endpoint yet: keep what we have */
      }
    }
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [session])
  return history
}
