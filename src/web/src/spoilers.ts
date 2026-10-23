import { useSyncExternalStore } from 'react'

/**
 * Hide results ("spoiler-free"), for watching a replay without knowing how it ends: the session's results page keeps
 * its classification at full size with every value covered (owner: same height, opaque data) and its other tabs
 * shut, and the replay's scrubber only marks what the replay has already reached (safety cars, red flags, lap ticks,
 * the chequered flag). The leaderboard, map and feed show the replay's moment anyway. One setting for the
 * whole site, Supercars and F1 alike, in its own storage key (like timeZone.ts), so it survives a refresh and every
 * page sees a change at once.
 */
const KEY = 'supercars-timing:hide-results'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false // private mode / blocked storage
  }
}

let current = read()

export function setHideResults(hide: boolean) {
  current = hide
  try { localStorage.setItem(KEY, String(hide)) } catch { /* not remembered, but still applies now */ }
  listeners.forEach((l) => l())
}

export function useHideResults(): [boolean, (hide: boolean) => void] {
  const hide = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => current)
  return [hide, setHideResults]
}
