import { useEffect, useState } from 'react'
import type { RecordedSession } from '../types'
import { SERIES_UPCOMING, eventEnd, eventStart, type UpcomingEvent } from '../calendar'
import { hasScenery, trackManifest } from '../tracks'
import { isF1, API_BASE } from '../series'
import { splitSessionName } from '../session'
import { SeriesSwitch } from './SeriesSwitch'

/** Slide-out menu: live timing, results of previous Supercars sessions, and upcoming events. */
export function Menu({ open, onClose, resultsId, previewName, onWatchLive, onResults, onPreview }: {
  open: boolean
  onClose: () => void
  /** Session whose results are on screen, or null. */
  resultsId: string | null
  /** Upcoming event whose page is on screen, or null. Live timing is on screen when neither is set. */
  previewName: string | null
  onWatchLive: () => void
  onResults: (session: RecordedSession) => void
  /** Open an upcoming event's page (timetable and map). */
  onPreview: (event: UpcomingEvent) => void
}) {
  const [sessions, setSessions] = useState<RecordedSession[] | null>(null)
  const now = useNow(open)

  // Refresh the list each time the menu opens: new sessions get recorded all weekend.
  useEffect(() => {
    if (!open) return
    fetch(`${API_BASE}/sessions`).then((r) => (r.ok ? r.json() : [])).then(setSessions).catch(() => setSessions([]))
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const byMeeting = groupBy(sessions ?? [], (s) => s.meeting || 'Other')
  // Earlier seasons (e.g. last year's races, rebuilt from Natsoft's published times by tools/HistoricalRace) get their
  // own section under this season's results.
  const yearOf = (meeting: string) => Number(meeting.match(/^(\d{4})\s/)?.[1] ?? 0)
  const season = Math.max(0, ...Object.keys(byMeeting).map(yearOf))
  const meetings = Object.entries(byMeeting)
  const current = meetings.filter(([m]) => yearOf(m) === 0 || yearOf(m) === season)
  const past = meetings.filter(([m]) => yearOf(m) !== 0 && yearOf(m) !== season)
  // Each meeting's sessions are folded under its name; the meeting on screen starts unfolded. A click overrides that
  // either way (it used to only add to the open set, so the meeting on screen could never be folded).
  const [folded, setFolded] = useState<Map<string, boolean>>(new Map())
  const activeMeeting = sessions?.find((s) => s.id === resultsId)?.meeting
  const isOpen = (meeting: string) => folded.get(meeting) ?? meeting === activeMeeting
  const toggle = (meeting: string) => setFolded((prev) => new Map(prev).set(meeting, !isOpen(meeting)))

  const renderMeeting = (meeting: string, list: RecordedSession[], withYear = false) => (
            <div key={meeting} className="menu-group">
              <h3>
                <button type="button" className="menu-meeting" aria-expanded={isOpen(meeting)} onClick={() => toggle(meeting)}>
                  <span className="menu-chevron" aria-hidden>{isOpen(meeting) ? '▾' : '▸'}</span>
                  {withYear ? meeting : meeting.replace(/^\d{4}\s+/, '')}
                  <span className="menu-count">{list.length} {list.length === 1 ? 'session' : 'sessions'}</span>
                </button>
              </h3>
              {isOpen(meeting) && Object.entries(groupBy(list, (s) => dayLabel(s.start))).map(([day, daySessions]) => (
                <div key={day}>
                  <div className="menu-day">{day}</div>
                  {daySessions.map((s) => {
                    const { session } = splitSessionName(s.name)
                    return (
                      <button key={s.id} type="button" className={`menu-item session${s.id === resultsId ? ' active' : ''}`}
                        onClick={() => { onResults(s); onClose() }}>
                        <span className="session-name">{session}{s.id.includes('_hist-') && <span className="menu-tag" title="Rebuilt from Natsoft's published lap and sector times (tools/HistoricalRace): some times are estimates">rebuilt</span>}</span>
                        <span className="session-meta">{timeLabel(s.start)} · {Math.round(s.durationSeconds / 60)} min</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          
  )

  return (
    <>
      <div className={`menu-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <nav className={`menu${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Menu">
        <div className="menu-head">
          <span>{isF1 ? 'F1 Timing' : 'Supercars Timing'}</span>
          <button type="button" onClick={onClose} aria-label="Close menu">×</button>
        </div>

        <section>
          <h2>Series</h2>
          <SeriesSwitch inMenu />
        </section>

        <section>
          <h2>Live</h2>
          <button type="button" className={`menu-item${resultsId || previewName ? '' : ' active'}`} onClick={() => { onWatchLive(); onClose() }}>
            <span className="live-dot" /> Live timing
          </button>
        </section>

        {/* Results and replays: our recordings (Natsoft for Supercars, F1's hub for F1) and, for F1, archive folders. */}
        {<section>
          <h2>Results</h2>
          {sessions === null && <p className="menu-muted">Loading…</p>}
          {sessions?.length === 0 && <p className="menu-muted">No results yet. Sessions appear here once they've been recorded.</p>}
          {current.map(([meeting, list]) => renderMeeting(meeting, list))}
        </section>}

        {past.length > 0 && <section>
          <h2>Past seasons</h2>
          {past.map(([meeting, list]) => renderMeeting(meeting, list, true))}
        </section>}

        <section>
          <h2>Upcoming</h2>
          {/* Listed until the last day is over, so the weekend that's under way stays at the top. */}
          {SERIES_UPCOMING.filter((e) => eventEnd(e).getTime() > now).map((e) => {
            const map = e.trackCode ? trackManifest[e.trackCode] : undefined
            const underWay = eventStart(e).getTime() <= now
            return (
              <button key={e.name} type="button" className={`upcoming${e.name === previewName ? ' active' : ''}`} onClick={() => { onPreview(e); onClose() }} title="Open the event: session times and map">
                <span className="upcoming-top">
                  <span className="upcoming-name">{e.name}</span>
                  <span className="soon">{underWay ? 'This weekend' : 'Coming soon'}</span>
                </span>
                <span className="session-meta">{e.venue} · {e.location}</span>
                <span className="session-meta">{dateRange(e.startDate, e.endDate)}{e.format ? ` · ${e.format}` : ''}</span>
                <span className="upcoming-bottom">
                  <span className="countdown">{countdown(eventStart(e).getTime() - now)}</span>
                  <span className={`map-status ${map ? (map.provisional ? 'provisional' : 'mapped') : 'none'}`}>
                    {/* "3D map" when the track has scenery (buildings, water, landmarks) for the full 3D view. */}
                    {map
                      ? `${e.trackCode && hasScenery(e.trackCode) ? '3D map' : 'Map'}${map.provisional ? ': provisional' : ': ready'}`
                      : 'Map: not yet'}
                  </span>
                </span>
              </button>
            )
          })}
        </section>
      </nav>
    </>
  )
}

/** Current time, ticking every second while `active`. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of items) (out[key(item)] ??= []).push(item)
  return out
}

/** "2026 Repco Supercars Championship - Practice 6 (All Drivers)" -> series + session. */
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function dateRange(start: string, end: string) {
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

function countdown(ms: number) {
  if (ms <= 0) return 'Race weekend under way'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return d > 0 ? `${d}d ${h}h ${m}m ${String(sec).padStart(2, '0')}s` : `${h}h ${m}m ${String(sec).padStart(2, '0')}s`
}
