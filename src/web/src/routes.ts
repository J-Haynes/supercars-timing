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
 *   /                          live timing
 *   /results/:sessionId        a recorded session's results
 *   /results/:sessionId/replay its replay (local only: the server refuses replays through the tunnel, RemoteAccess.cs)
 *   /events/:slug              an upcoming event (timetable, map), e.g. /events/penrite-oil-sandown-500
 *
 * The server sends index.html for any path that isn't an API or a file (MapFallbackToFile in Program.cs). Session ids
 * are letters, digits, `_` and `-` (V8SUPER_20261025_151501-0, F1_11396): a dot would make the path look like a file.
 */
export const paths = {
  live: '/',
  results: (sessionId: string) => `/results/${encodeURIComponent(sessionId)}`,
  replay: (sessionId: string) => `/results/${encodeURIComponent(sessionId)}/replay`,
  event: (event: UpcomingEvent) => `/events/${eventSlug(event)}`,
}

export type Route =
  | { page: 'live' }
  | { page: 'results'; sessionId: string; replay: boolean }
  | { page: 'event'; slug: string; event: UpcomingEvent | null }
  | { page: 'unknown' }

/** The page the URL points to. Shared by the header, the menu and the page itself, so they always agree. */
export function useRoute(): Route {
  const { pathname } = useLocation()
  if (pathname === '/' || pathname === '') return { page: 'live' }
  const results = matchPath('/results/:sessionId', pathname)
  if (results) return { page: 'results', sessionId: results.params.sessionId!, replay: false }
  const replay = matchPath('/results/:sessionId/replay', pathname)
  if (replay) return { page: 'results', sessionId: replay.params.sessionId!, replay: true }
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
 * The recorded session a results or replay URL names. The menu passes the session it was clicked on as the
 * navigation's state, so that's shown at once; otherwise (a refresh, a shared link) it comes from the session list.
 * `undefined` while loading, `null` if there's no such session.
 */
export function useRecordedSession(sessionId: string | null): RecordedSession | null | undefined {
  const { state } = useLocation()
  const passed = isSession(state) && state.id === sessionId ? state : null
  const [found, setFound] = useState<{ id: string; session: RecordedSession | null } | null>(null)

  useEffect(() => {
    if (!sessionId || passed) return
    let current = true
    // ?all=true: support categories too (Supercars; F1 ignores it), so a link to any recorded session works.
    fetch(`${API_BASE}/sessions?all=true`)
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((list: RecordedSession[]) => { if (current) setFound({ id: sessionId, session: list.find((s) => s.id === sessionId) ?? null }) })
    return () => { current = false }
  }, [sessionId, passed])

  if (!sessionId) return null
  if (passed) return passed
  return found?.id === sessionId ? found.session : undefined
}

function isSession(value: unknown): value is RecordedSession {
  return typeof value === 'object' && value !== null && typeof (value as RecordedSession).id === 'string'
    && typeof (value as RecordedSession).meeting === 'string'
}
