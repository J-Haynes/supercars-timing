import { useEffect, useState } from 'react'
import { matchPath, useLocation } from 'react-router'
import { SERIES_UPCOMING, type UpcomingEvent } from './calendar'
import { API_BASE } from './series'
import type { RecordedSession } from './types'

/**
 * The app's pages and their URLs. Live timing is the home page; results, replays and upcoming events each have their
 * own URL, so a refresh keeps the page, Back works, and a page can be bookmarked or shared. Paths are relative to the
 * series (main.tsx sets the router's basename to /f1 in the F1 app), so they're the same in both apps:
 *
 *   /                                     live timing
 *   /results/2026/gold-coast-500/race-32         a recorded session's results (the session's slug)
 *   /results/2026/gold-coast-500/race-32/replay  its replay (local only: the server refuses replays through the tunnel)
 *   /events/penrite-oil-sandown-500              an upcoming event (timetable, map)
 *
 * Session slugs come from the server (SessionSlug.cs: year, round, support series, session; a-z, 0-9, '-', '/'). A
 * results URL with the session's id instead (/results/V8SUPER_20261025_151501-0, the first form of these links) still
 * works: App redirects it to the slug. The server sends index.html for any path that isn't an API or a file
 * (MapFallbackToFile in Program.cs); a dot would make the path look like a file, so slugs and ids have none.
 */
export const paths = {
  live: '/',
  results: (session: RecordedSession) => `/results/${session.slug}`,
  replay: (session: RecordedSession) => `/results/${session.slug}/replay`,
  event: (event: UpcomingEvent) => `/events/${eventSlug(event)}`,
}

export type Route =
  | { page: 'live' }
  /** `key`: the session's slug, or its id in an older link. */
  | { page: 'results'; key: string; replay: boolean }
  | { page: 'event'; slug: string; event: UpcomingEvent | null }
  | { page: 'unknown' }

/** The page the URL points to. Shared by the header, the menu and the page itself, so they always agree. */
export function useRoute(): Route {
  const { pathname } = useLocation()
  if (pathname === '/' || pathname === '') return { page: 'live' }
  // A slug has several levels ("2026/gold-coast-500/race-32"), so everything after /results/ is the key.
  const results = matchPath('/results/*', pathname)
  if (results) {
    const rest = results.params['*']!.replace(/\/$/, '')
    const replay = rest.endsWith('/replay')
    return { page: 'results', key: replay ? rest.slice(0, -'/replay'.length) : rest, replay }
  }
  const event = matchPath('/events/:slug', pathname)
  if (event) {
    const slug = event.params.slug!
    return { page: 'event', slug, event: SERIES_UPCOMING.find((e) => eventSlug(e) === slug) ?? null }
  }
  return { page: 'unknown' }
}

/** "Penrite Oil Sandown 500" -> "penrite-oil-sandown-500". */
export function eventSlug(event: UpcomingEvent): string {
  return event.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * The recorded session a results or replay URL names, by slug (or by id, in an older link). The menu passes the
 * session it was clicked on as the navigation's state, so that's shown at once; otherwise (a refresh, a shared link)
 * it comes from the session list. `undefined` while loading, `null` if there's no such session.
 */
export function useRecordedSession(key: string | null): RecordedSession | null | undefined {
  const { state } = useLocation()
  const matches = (s: RecordedSession) => s.slug === key || s.id === key
  const passed = isSession(state) && matches(state) ? state : null
  const [found, setFound] = useState<{ key: string; session: RecordedSession | null } | null>(null)

  useEffect(() => {
    if (!key || passed) return
    let current = true
    // ?all=true: support categories too (Supercars; F1 ignores it), so a link to any recorded session works.
    fetch(`${API_BASE}/sessions?all=true`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((list: RecordedSession[]) => {
        if (current) setFound({ key, session: list.find((s) => s.slug === key) ?? list.find((s) => s.id === key) ?? null })
      })
    return () => { current = false }
  }, [key, passed])

  if (!key) return null
  if (passed) return passed
  return found?.key === key ? found.session : undefined
}

function isSession(value: unknown): value is RecordedSession {
  return typeof value === 'object' && value !== null && typeof (value as RecordedSession).id === 'string'
    && typeof (value as RecordedSession).slug === 'string'
}
