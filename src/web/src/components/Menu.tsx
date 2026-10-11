import { useEffect, useState } from 'react'
import type { RecordedSession } from '../types'
import { SERIES_UPCOMING, eventEnd, eventStart, type UpcomingEvent } from '../calendar'
import { trackManifest } from '../tracks'
import { isF1 } from '../series'

/** Slide-out menu: live timing, results of previous Supercars sessions, and upcoming events. */
export function Menu({ open, onClose, resultsId, onWatchLive, onResults, onPreview }: {
  open: boolean
  onClose: () => void
  /** Session whose results are on screen, or null for live timing. */
  resultsId: string | null
  onWatchLive: () => void
  onResults: (session: RecordedSession) => void
  /** Open an upcoming event's page (timetable and map). */
  onPreview: (event: UpcomingEvent) => void
}) {
  const [sessions, setSessions] = useState<RecordedSession[] | null>(null)
  const now = useNow(open)

  // Refresh the list each time the menu opens: new sessions get recorded all weekend.
  useEffect(() => {
    if (!open || isF1) return
    fetch('/api/sessions').then((r) => (r.ok ? r.json() : [])).then(setSessions).catch(() => setSessions([]))
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const byMeeting = groupBy(sessions ?? [], (s) => s.meeting || 'Other')

  return (
    <>
      <div className={`menu-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <nav className={`menu${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Menu">
        <div className="menu-head">
          <span>{isF1 ? 'F1 Timing' : 'Supercars Timing'}</span>
          <button type="button" onClick={onClose} aria-label="Close menu">×</button>
        </div>

        <section>
          <h2>Live</h2>
          <button type="button" className={`menu-item${resultsId ? '' : ' active'}`} onClick={() => { onWatchLive(); onClose() }}>
            <span className="live-dot" /> Live timing
          </button>
        </section>

        {/* Results and replays come from our Natsoft recordings; F1 sessions aren't listed there yet. */}
        {!isF1 && <section>
          <h2>Results</h2>
          {sessions === null && <p className="menu-muted">Loading…</p>}
          {sessions?.length === 0 && <p className="menu-muted">No results yet. Supercars sessions appear here once they've been recorded.</p>}
          {Object.entries(byMeeting).map(([meeting, list]) => (
            <div key={meeting} className="menu-group">
              <h3>{meeting.replace(/^\d{4}\s+/, '')}</h3>
              {Object.entries(groupBy(list, (s) => dayLabel(s.start))).map(([day, daySessions]) => (
                <div key={day}>
                  <div className="menu-day">{day}</div>
                  {daySessions.map((s) => {
                    const { session } = splitName(s.name)
                    return (
                      <button key={s.id} type="button" className={`menu-item session${s.id === resultsId ? ' active' : ''}`}
                        onClick={() => { onResults(s); onClose() }}>
                        <span className="session-name">{session}</span>
                        <span className="session-meta">{timeLabel(s.start)} · {Math.round(s.durationSeconds / 60)} min</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
        </section>}

        <section>
          <h2>Upcoming</h2>
          {/* Listed until the last day is over, so the weekend that's under way stays at the top. */}
          {SERIES_UPCOMING.filter((e) => eventEnd(e).getTime() > now).map((e) => {
            const map = e.trackCode ? trackManifest[e.trackCode] : undefined
            const underWay = eventStart(e).getTime() <= now
            return (
              <button key={e.name} type="button" className="upcoming" onClick={() => { onPreview(e); onClose() }} title="Open the event: session times and map">
                <span className="upcoming-top">
                  <span className="upcoming-name">{e.name}</span>
                  <span className="soon">{underWay ? 'This weekend' : 'Coming soon'}</span>
                </span>
                <span className="session-meta">{e.venue} · {e.location}</span>
                <span className="session-meta">{dateRange(e.startDate, e.endDate)}{e.format ? ` · ${e.format}` : ''}</span>
                <span className="upcoming-bottom">
                  <span className="countdown">{countdown(eventStart(e).getTime() - now)}</span>
                  <span className={`map-status ${map ? (map.provisional ? 'provisional' : 'mapped') : 'none'}`}>
                    {map ? (map.provisional ? 'Map: provisional' : 'Map: ready') : 'Map: not yet'}
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
function splitName(name: string) {
  const [series, ...rest] = name.replace(/^\d{4}\s+/, '').split(' - ')
  return rest.length ? { series, session: rest.join(' - ') } : { series: '', session: series }
}

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
