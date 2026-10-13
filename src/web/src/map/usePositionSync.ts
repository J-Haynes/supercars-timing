import { useRef } from 'react'
import type { CarRow } from '../types'

/** Fraction of on-track cars that must pass a timing point after the page loads before the map counts as synced. */
const SYNCED_SHARE = 0.9
/** Give up waiting after this long (a stopped car or a quiet feed shouldn't keep the notice up). */
const MAX_WAIT_MS = 45_000

/** Sessions this page has already synced: a map view mounted later (2D <-> 3D switch) doesn't grey out again. */
const syncedSessions = new Set<string>()

/**
 * After the page loads, how many cars have passed a timing point since. Until most have, the map's estimates are
 * based on crossings from before the page loaded, so TrackMap shows a "syncing" notice.
 * Resets when the session changes.
 */
export function usePositionSync(cars: CarRow[], sessionKey: string, running: boolean) {
  const start = useRef<{ key: string; at: number; lastPointAt: Map<string, number> } | null>(null)
  if (!start.current || start.current.key !== sessionKey) {
    start.current = { key: sessionKey, at: performance.now(), lastPointAt: new Map(cars.map((c) => [c.id, c.lastPointAt])) }
  }
  const first = start.current
  const onTrack = cars.filter((c) => !c.inPit && c.lastPoint)
  const updated = onTrack.filter((c) => {
    const before = first.lastPointAt.get(c.id)
    if (before === undefined) first.lastPointAt.set(c.id, c.lastPointAt) // joined after load: count from now
    return before !== undefined && c.lastPointAt > before
  }).length
  const synced = syncedSessions.has(sessionKey) || !running || onTrack.length === 0 || updated >= onTrack.length * SYNCED_SHARE
    || performance.now() - first.at > MAX_WAIT_MS
  if (synced && running) syncedSessions.add(sessionKey)
  return { synced, updated, total: onTrack.length, markSynced: () => { syncedSessions.add(sessionKey) } }
}
