import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { SERIES_UPCOMING, eventStart, type UpcomingEvent } from '../calendar'
import { browserTimeZone, formatSessionTime, useTimeZoneChoice } from '../timeZone'
import { useTrack } from '../tracks'
import { ErrorBoundary } from './ErrorBoundary'
import type { TimingUpdate } from '../types'
import { useWeekends } from '../useWeekend'
import { nextWeekend } from '../weekend'
import { CoverageDetails } from './WeekendPanels'

// three.js is large: the same lazy chunk as the live map.
const TrackMap3D = lazy(() => import('./TrackMap3D'))

/**
 * The live page between sessions. One job, readable from a second monitor: what's on next and how long until it
 * starts, over the track turning slowly in 3D. The event page (timetable, standings, about the event) is one click
 * away; this page doesn't repeat it. From the timetable in calendar.ts (both series). `detail` is the server's own
 * status line (when it will connect to the feed).
 */
export function NextSession({ detail, onOpenEvent }: { detail?: string | null; onOpenEvent: (event: UpcomingEvent) => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  // Times in the viewer's zone or the track's: the same site-wide setting as the event pages (timeZone.ts).
  const [zone, setZone] = useTimeZoneChoice()
  const mine = browserTimeZone()
  const weekends = useWeekends(SERIES_UPCOMING)
  const next = nextWeekend(SERIES_UPCOMING, weekends, now)
  const weekend = weekends.find(w => w?.eventName === next?.event.name && w?.startDate === next?.event.startDate)
  const track = useTrack(next?.event.trackCode, next?.event.venue)
  const empty = useMemo(() => next && emptyUpdate(next.event), [next?.event]) // eslint-disable-line react-hooks/exhaustive-deps -- same event, same update

  if (!next || !empty) return <div className="empty">No session on track right now. Timing appears automatically when one starts.</div>
  const { event } = next
  const session = next.session
  const startsAt = session ? new Date(session.start) : eventStart(event)
  const when = formatSessionTime(startsAt, zone, event.utcOffset)
  const under = startsAt.getTime() <= now

  return (
    <section className="next-session" aria-label="Next session">
      <div className="next-hero">
        {track && (
          <ErrorBoundary fallback={null}>
            <Suspense fallback={null}>
              <TrackMap3D bare track={track} update={empty} hoverId={null} pinned={[]} camera="orbit" followCar={null} views={null}
                cornerLabels cornersButton={null} showBattles={false} flatBuildings={false} onFlatBuildings={() => {}}
                showLandmarks={false} onShowLandmarks={() => {}} pitGhost={null} onFollowCar={() => {}} onHover={() => {}} onTogglePin={() => {}} />
            </Suspense>
          </ErrorBoundary>
        )}
        <div className="next-over">
          <div className="next-what">
            {/* The event is the headline; the session on next is a step down. */}
            <h2 className="next-event">{event.name}</h2>
            <div className="next-venue">{event.venue}</div>
            <div className="next-name">{session?.name ?? 'Race weekend'}</div>
            {/* The switch comes first: its label changes width ("your time (AEDT)" / "track time (UTC+11:00)"), and a
                switch after it moved under the pointer on every click. */}
            <div className="next-when">
              <div className="segmented small" role="radiogroup" aria-label="Show times in">
                <button type="button" role="radio" aria-checked={zone === 'mine'} className={zone === 'mine' ? 'active' : ''} onClick={() => setZone('mine')}
                  title={`Your time zone: ${mine.id}`}>Your time</button>
                <button type="button" role="radio" aria-checked={zone === 'track'} className={zone === 'track' ? 'active' : ''} onClick={() => setZone('track')}
                  title={`At the track: UTC${event.utcOffset}`}>Track time</button>
              </div>
              <span>{when.day} · {when.time} <span className="next-zone">{zone === 'mine' ? `your time (${mine.short})` : `track time (UTC${event.utcOffset})`}</span></span>
            </div>
          </div>
          <div className="next-countdown" role="timer" aria-label={under ? 'Under way' : `Starts in ${countdown(startsAt.getTime() - now)}`}>
            {under ? 'Under way' : countdown(startsAt.getTime() - now)}
          </div>
        </div>
      </div>
      {session && <aside className="next-coverage" aria-label="TV coverage for the next session">
        <h3>TV coverage · {session.name}</h3>
        <CoverageDetails coverage={session.coverage} event={event} zone={zone} />
        {weekend?.note && <p className="chart-note">{weekend.note}</p>}
        <p className="chart-note">Australian broadcast listings · {zone === 'mine' ? `your time (${mine.id})` : `track time (UTC${event.utcOffset})`}.</p>
      </aside>}
      <div className="next-actions">
        <button type="button" className="back-button" onClick={() => onOpenEvent(event)}>Event page: timetable and standings</button>
        <span className="next-detail">Timing appears here automatically when the session starts.{detail && (detail.startsWith('Not connected') || detail.startsWith('A support')) ? ` ${detail}.` : ''}</span>
      </div>
    </section>
  )
}

/** The map needs a timing update; an empty one (no cars, no timing points) draws the circuit only. */
function emptyUpdate(event: UpcomingEvent): TimingUpdate {
  return {
    feed: { mode: 'Live', state: 'waiting', detail: null, clockRate: 0 },
    timing: {
      session: { meeting: event.name, name: '', type: '', track: event.venue, trackCode: event.trackCode ?? '', flag: '', clockRemaining: null, clockElapsed: null, scheduledLaps: 0 },
      timingPoints: [], best: { lap: null, s1: null, s2: null, s3: null, speed: null }, cars: [], segmentReference: [], segmentBest: [], now: 0, messageCount: 0,
    },
  }
}

/** "1d 21h 04m", "3h 12m", "12m 05s": seconds only in the last hour. */
function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`
  if (h > 0) return `${h}h ${pad(m)}m`
  return `${m}m ${pad(s % 60)}s`
}
