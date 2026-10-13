import { useEffect, useState } from 'react'
import { isF1 } from '../series'
import type { RecordedSession, TimingSnapshot } from '../types'

/**
 * Typical seconds per stretch from an earlier recorded session at the same track with the same timing points, for
 * placing a provisional track's timing points (map/calibrate.ts) before this session has timed every stretch. Without
 * it the map said "building the track map" for the first lap or two of every session at a provisional track (seen on
 * the rebuilt 2025 Gold Coast replays). The newest matching session wins; null until found or if there's none (the
 * first session at a new track: Natsoft's live timing points there aren't known yet). Supercars only: F1 tracks
 * aren't provisional.
 */
export function useReferenceFallback(trackCode: string, order: string[], needed: boolean): number[] | null {
  const key = `${trackCode}|${order.join(',')}`
  const [found, setFound] = useState<{ key: string; reference: number[] | null } | null>(null)
  useEffect(() => {
    if (!needed || isF1 || !trackCode || order.length < 2 || found?.key === key) return
    let cancelled = false
    lookup(trackCode, order).then((reference) => { if (!cancelled) setFound({ key, reference }) })
    return () => { cancelled = true }
  }, [key, needed]) // eslint-disable-line react-hooks/exhaustive-deps -- key covers trackCode and order
  return found?.key === key ? found.reference : null
}

const cache = new Map<string, Promise<number[] | null>>()

function lookup(trackCode: string, order: string[]): Promise<number[] | null> {
  const key = `${trackCode}|${order.join(',')}`
  let p = cache.get(key)
  if (!p) {
    p = search(trackCode, order).catch(() => null)
    cache.set(key, p)
  }
  return p
}

async function search(trackCode: string, order: string[]): Promise<number[] | null> {
  const sessions: RecordedSession[] = await fetch('/api/sessions').then((r) => (r.ok ? r.json() : []))
  // Newest first (the API's order); a few at most, each is a replay on the server (cached there).
  for (const s of sessions.filter((x) => x.trackCode === trackCode).slice(0, 4)) {
    const results: TimingSnapshot | null = await fetch(`/api/sessions/${encodeURIComponent(s.id)}/results`).then((r) => (r.ok ? r.json() : null))
    const ids = results ? ['M', ...results.timingPoints.map((p) => p.id)] : []
    const ref = results?.segmentReference ?? []
    if (ids.join(',') === order.join(',') && ref.length === order.length && ref.every((x) => x > 0)) return ref
  }
  return null
}
