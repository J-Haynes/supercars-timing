import { useEffect, useState } from 'react'
import type { RecordedSession, TimingSnapshot } from './types'
import { finishedRaces, priorFinalsSessions, resultOrder, type FinalsRound } from './finals'

/** Re-check for newly finished races this often during a Finals round. */
const REFRESH_MS = 60_000

/**
 * Finishing orders (car numbers) of the races already run at a Finals round, from the server's own recordings
 * (GET /api/sessions, /api/sessions/{id}/results): the points drivers have earned there so far. Only races that
 * started before `currentSession` (in a replay of Race 31, Race 32 hasn't happened yet); all of them when it's empty
 * (the event page). Null until loaded.
 *
 * Only races that finished count (finishedRaces): the recordings also hold pieces of a race, e.g. Race 31's first
 * 4 minutes before a restart (still on the grid: its order gave Feeney a win and 150 points), and the race on now.
 */
export function useFinalsData(round: FinalsRound | undefined, currentSession = '', currentMeeting = '') {
  const key = `${round?.firstRace}/${currentMeeting}/${currentSession}`
  const [data, setData] = useState<{ key: string; earlier: string[][]; raceNumbers: number[] } | null>(null)
  useEffect(() => {
    if (!round) return
    let cancelled = false
    const results = async (s: RecordedSession) => (await (await fetch(`/api/sessions/${encodeURIComponent(s.id)}/results`)).json()) as TimingSnapshot
    const load = async () => {
      try {
        const sessions = (await (await fetch('/api/sessions')).json()) as RecordedSession[]
        const candidates = priorFinalsSessions(sessions, round, currentSession ? { name: currentSession, meeting: currentMeeting } : undefined)
        const races = await Promise.all(candidates.map(async (session) => ({ session, results: await results(session) })))
        const earlier = finishedRaces(races)
        if (!cancelled) setData({ key, earlier: earlier.map((r) => resultOrder(r.results)),
          raceNumbers: earlier.map(r => Number(/race (\d+)$/i.exec(r.session.name)?.[1])) })
      } catch {
        /* keep what we have */
      }
    }
    load()
    const id = window.setInterval(load, REFRESH_MS)
    return () => { cancelled = true; window.clearInterval(id) }
  }, [round, currentSession, currentMeeting, key])
  return data?.key === key ? data : null
}
