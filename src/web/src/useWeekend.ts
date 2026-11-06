import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UpcomingEvent } from './calendar'
import { SERIES } from './series'
import bundledWeekends from './schedule/weekends.json'
import bundledStandings from './schedule/standings.json'
import type { ChampionshipStandings, WeekendData } from './weekend'

/** Seed immediately for offline/portable use; the server coalesces and caches source refreshes for all viewers. */
function useSnapshot<T extends { note?: string | null }>(url: string | null, fallback: T | null): T | null {
  const [state, setState] = useState({ url, data: fallback })
  useEffect(() => {
    if (!url) return
    let stopped = false
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(url!, { signal: controller.signal })
        if (!response.ok) throw new Error('Source unavailable')
        const data = await response.json() as T
        if (!stopped) setState({ url, data })
      } catch {
        if (!stopped) setState(old => ({ url, data: old.url === url && old.data
          ? { ...old.data, note: 'Refresh unavailable; showing the last checked snapshot.' }
          : fallback && { ...fallback, note: 'Refresh unavailable; showing the bundled snapshot.' } }))
      }
    }
    void load()
    const timer = window.setInterval(load, 5 * 60_000)
    return () => { stopped = true; controller.abort(); window.clearInterval(timer) }
  }, [url, fallback])
  return state.url === url ? state.data : fallback
}

const weekendCache = new Map((bundledWeekends as WeekendData[]).filter(w => w.series === SERIES).map(w => [w.startDate, w]))
const listeners = new Set<() => void>()
let version = 0
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } }

/** Event selection and its displayed session share this refreshed cache, including changed final-session ends. */
export function useWeekends(events: UpcomingEvent[]): (WeekendData | null)[] {
  useSyncExternalStore(subscribe, () => version)
  const dates = events.map(e => e.startDate).join(',')
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      await Promise.all(dates.split(',').filter(Boolean).map(async date => {
        let data = weekendCache.get(date)
        try {
          const response = await fetch(`/api/weekend/${SERIES}/${date}`, { signal: controller.signal })
          if (!response.ok) throw new Error('Source unavailable')
          data = await response.json() as WeekendData
        } catch {
          if (data) data = { ...data, note: 'Refresh unavailable; showing the last checked snapshot.' }
        }
        if (!controller.signal.aborted && data) {
          weekendCache.set(date, data)
          version++
          listeners.forEach(notify => notify())
        }
      }))
    }
    void load()
    const timer = window.setInterval(load, 5 * 60_000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [dates])
  return events.map(e => {
    const data = weekendCache.get(e.startDate)
    return data?.eventName === e.name ? data : null
  })
}

export function useWeekend(event?: UpcomingEvent): WeekendData | null { return useWeekends(event ? [event] : [])[0] ?? null }

export function useStandings(season: number): ChampionshipStandings | null {
  const bundled = (bundledStandings as ChampionshipStandings[]).find(s => s.series === SERIES && s.season === season) ?? null
  return useSnapshot(`/api/standings/${SERIES}/${season}`, bundled)
}
