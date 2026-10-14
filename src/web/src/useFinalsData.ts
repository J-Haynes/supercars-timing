import { useEffect, useState } from 'react'
import type { RecordedSession, TimingSnapshot } from './types'
import { racesOf, resultOrder, type FinalsRound } from './finals'

/** Re-check for newly finished races this often during a Finals round. */
const REFRESH_MS = 60_000

/**
 * Finishing orders (car numbers) of the races already run at a Finals round, from the server's own recordings
 * (GET /api/sessions, /api/sessions/{id}/results): the points drivers have earned there so far. Only races that
 * started before `currentSession` (in a replay of Race 31, Race 32 hasn't happened yet); all of them when it's empty
 * (the event page). Null until loaded.
 */
export function useFinalsData(round: FinalsRound | undefined, currentSession: string) {
  const [data, setData] = useState<{ earlier: string[][] } | null>(null)
  useEffect(() => {
    if (!round) return
    let cancelled = false
    const results = async (s: RecordedSession) => (await (await fetch(`/api/sessions/${encodeURIComponent(s.id)}/results`)).json()) as TimingSnapshot
    const load = async () => {
      try {
        const sessions = (await (await fetch('/api/sessions')).json()) as RecordedSession[]
        const races = racesOf(sessions, round.meeting)
        const current = races.find((s) => s.name === currentSession)
        const earlier = races.filter((s) => s.name !== currentSession && (!current || s.start < current.start))
        const orders = await Promise.all(earlier.map(async (s) => resultOrder(await results(s))))
        if (!cancelled) setData({ earlier: orders })
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
