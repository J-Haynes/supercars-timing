import { useEffect, useState, type CSSProperties } from 'react'
import type { TimingUpdate } from '../types'
import { eventStart, sessionTime, type UpcomingEvent } from '../calendar'
import { useTrack } from '../tracks'
import { useSettings } from '../settings'
import { MapView } from './MapView'
import { ColumnSplitter } from './ColumnSplitter'
import { ErrorBoundary } from './ErrorBoundary'
import { isF1, SERIES_LABEL, SERIES } from '../series'

/** "3d 4h", "2h 10m", "5m"; past times as "Done". */
function until(ms: number): string {
  if (ms <= 0) return ''
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24)
  return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m % 60}m` : `${m}m`
}

const DAY = new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Page for an upcoming event (opened from the menu): details, the Supercars session timetable with countdowns, and the
 * track map. A provisional map (no recording at the track yet) shows as work in progress: it's built from
 * OpenStreetMap, and the timing points are placed from live pace during the first session.
 */
export function EventPreview({ event, onLive }: { event: UpcomingEvent; onLive: () => void }) {
  const track = useTrack(event.trackCode, event.venue)
  const { settings, update: updateSettings } = useSettings()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(id) }, [])

  // The map needs a timing update; an empty one (no cars, no timing points) draws the circuit only.
  const empty: TimingUpdate = {
    feed: { mode: 'Live', state: 'waiting', detail: null, clockRate: 0 },
    timing: {
      session: { meeting: event.name, name: '', type: '', track: event.venue, trackCode: event.trackCode ?? '', flag: '', clockRemaining: null, clockElapsed: null, scheduledLaps: 0 },
      timingPoints: [], best: { lap: null, s1: null, s2: null, s3: null, speed: null }, cars: [], segmentReference: [], segmentBest: [], now: 0, messageCount: 0,
    },
  }
  const sessions = event.sessions ?? []
  const next = sessions.find((s) => sessionTime(event, s.end ?? s.start).getTime() > now)

  return (
    <div className="event-preview">
      <div className="results-head">
        <div>
          <div className="meeting">Upcoming · {event.location}</div>
          <h2>{event.name}</h2>
          <div className="track">{event.venue}{event.format ? ` · ${event.format}` : ''}</div>
        </div>
        <button type="button" className="link-button" onClick={onLive}>Back to live timing</button>
      </div>
      <div className={`layout${settings.mapWidth ? ' sized' : ''}`}
        style={settings.mapWidth ? { '--map-width': `${settings.mapWidth}px` } as CSSProperties : undefined}>
        <section className="event-sessions">
          <h3>{SERIES_LABEL[SERIES]} sessions <span className="ladder-live">provisional, local track time (UTC{event.utcOffset})</span></h3>
          {sessions.length === 0 ? (
            <p className="menu-muted">The session times haven't been published yet. The event starts in {until(eventStart(event).getTime() - now) || 'under a day'}.</p>
          ) : (
            <table className="event-table">
              <tbody>
                {sessions.map((s) => {
                  const start = sessionTime(event, s.start)
                  const done = sessionTime(event, s.end ?? s.start).getTime() <= now
                  return (
                    <tr key={s.name} className={[done ? 'done' : '', s === next ? 'next' : '', s.laps ? 'race' : ''].join(' ')}>
                      <td className="event-day">{DAY.format(new Date(`${s.start}:00Z`))}</td>
                      <td className="num">{s.start.slice(11)}{s.end ? `–${s.end.slice(11)}` : ''}</td>
                      <td>{s.name}{s.laps ? <span className="event-laps"> · {s.laps} laps</span> : ''}</td>
                      <td className="num event-until">{done ? 'Done' : s === next ? `in ${until(start.getTime() - now) || 'under a minute'}` : until(start.getTime() - now)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {event.sessionsSource && (
            <p className="chart-note">Times from <a href={event.sessionsSource} target="_blank" rel="noreferrer">{new URL(event.sessionsSource).hostname.replace(/^www\./, '')}</a>; they can change before the weekend.{isF1 && event.trackCode ? ' The map was built from F1\'s recorded car positions at this circuit.' : ''} Live timing appears automatically when a session starts.</p>
          )}
        </section>
        <ColumnSplitter width={settings.mapWidth} onWidth={(mapWidth) => updateSettings({ mapWidth })} />
        <aside className="map-panel">
          {track ? (
            <ErrorBoundary fallback={<div className="map-missing">The track map hit an error.</div>}>
              <MapView settings={settings} onSettings={updateSettings} track={track} update={empty} hoverId={null} focusId={null} pinned={[]}
                rotation={settings.mapRotation[track.code] ?? 0}
                onRotate={(deg) => updateSettings({ mapRotation: { ...settings.mapRotation, [track.code]: ((deg % 360) + 360) % 360 } })}
                onHover={() => {}} onTogglePin={() => {}}
                note={track.provisional
                  ? 'Work-in-progress map: the circuit is from OpenStreetMap. Timing points are placed from live pace during the first session, and refined from its recording after Practice 1.'
                  : undefined} />
            </ErrorBoundary>
          ) : (
            <div className="map-missing">No map for {event.venue} yet.</div>
          )}
        </aside>
      </div>
    </div>
  )
}
