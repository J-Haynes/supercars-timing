import { useEffect, useState } from 'react'
import type { RecordedSession, TimingSnapshot } from './types'
import { racesOf, resultOrder, type FinalsRound } from './finals'

/** Re-check for newly finished races this often during a Finals round. */
const REFRESH_MS = 60_000

/**
 * What the Finals ladder needs from recorded sessions: the Bathurst 1000's finishing order (to get standings after
 * it) and the finishing orders of races already completed at this round. Read from the server's own recordings
 * (GET /api/sessions, /api/sessions/{id}/results). Null until loaded or when Bathurst isn't recorded.
 */
export function useFinalsData(round: FinalsRound | undefined, currentSession: string) {
  const [data, setData] = useState<{ bathurst: string[]; earlier: string[][] } | null>(null)
  useEffect(() => {
    if (!round) return
    let cancelled = false
    const results = async (s: RecordedSession) => (await (await fetch(`/api/sessions/${encodeURIComponent(s.id)}/results`)).json()) as TimingSnapshot
    const load = async () => {
      try {
        const sessions = (await (await fetch('/api/sessions')).json()) as RecordedSession[]
        const bathurst = racesOf(sessions, /bathurst 1000/i).at(-1)
        if (!bathurst) return
        const earlier = racesOf(sessions, round.meeting).filter((s) => s.name !== currentSession)
        const orders = await Promise.all([bathurst, ...earlier].map(async (s) => resultOrder(await results(s))))
        if (!cancelled) setData({ bathurst: orders[0], earlier: orders.slice(1) })
      } catch {
        /* keep what we have */
      }
    }
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [round, currentSession])
  return data
}
