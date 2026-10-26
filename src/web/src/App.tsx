import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useTiming } from './useTiming'
import { useDelayedUpdate } from './useDelayedUpdate'
import { useSettings } from './settings'
import { SessionHeader } from './components/SessionHeader'
import { Controls } from './components/Controls'
import { TipsPanel } from './components/TipsPanel'
import { Menu } from './components/Menu'
import { ResultsView } from './components/ResultsView'
import { EventPreview } from './components/EventPreview'
import { ReplayView } from './components/ReplayView'
import { SessionView } from './components/SessionView'
import { NextSession } from './components/NextSession'
import type { UpcomingEvent } from './calendar'
import { SettingsPanel } from './components/SettingsPanel'
import { flagKind, isRace, isSupercarsSession } from './session'
import type { RecordedSession, TimingUpdate } from './types'
import { isF1 } from './series'
import { paths, useRecordedSession, useRoute } from './routes'
import { useFeatures } from './features'

export default function App() {
  const { update: latest, connection } = useTiming()
  const { settings, update: updateSettings, togglePinned } = useSettings()
  // Everything below shows the delayed update, so the tower, map and clock stay in sync with the broadcast.
  const { update, buffered } = useDelayedUpdate(latest, settings.delay)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The page on screen comes from the URL (routes.ts): live timing, a session's results or replay, or an upcoming event.
  const route = useRoute()
  const navigate = useNavigate()
  const results = useRecordedSession(route.page === 'results' ? route.sessionId : null)
  const preview = route.page === 'event' ? route.event : null
  const replaying = route.page === 'results' && route.replay
  const live = route.page === 'live'
  // The replay's current moment, reported by ReplayView, for the header.
  const [replayUpdate, setReplayUpdate] = useState<TimingUpdate | null>(null)
  // Replays are local only: not offered through the Cloudflare Tunnel (features.ts).
  const { replay: replayAllowed } = useFeatures()

  const timing = update?.timing
  // Support categories share the feed: only show Supercars Championship sessions.
  const supportSession = !isF1 && !!timing?.session.name && !isSupercarsSession(timing.session.name)
  const hasCars = !!timing && timing.cars.length > 0 && !supportSession
  // Red / yellow (safety car, full-course yellow) flags frame the whole screen while they're out.
  const kind = live && !supportSession && timing ? flagKind(timing.session.flag) : undefined
  const frame = kind === 'red' ? ' flag-frame flag-frame-red' : kind === 'caution' ? ' flag-frame flag-frame-yellow' : ''

  // The tab's title names the page, so history, bookmarks and tabs can tell them apart.
  const title = preview ? preview.name
    // F1 sessions are just "Race", "Qualifying": the meeting says which.
    : results ? `${sessionLabel(results)} · ${results.meeting} · ${replaying && replayAllowed ? 'Replay' : 'Results'}`
    : null
  useEffect(() => {
    const app = isF1 ? 'F1 Timing' : 'Supercars Timing'
    document.title = title ? `${title} · ${app}` : app
  }, [title])

  return (
    <div className={`app${frame}`}>
      <SessionHeader update={update} feed={latest?.feed} connection={connection} onMenu={() => setMenuOpen(true)} hideSession={supportSession}
        viewing={headerView(preview, results ?? null, replaying ? replayUpdate : null)} />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        resultsId={route.page === 'results' ? route.sessionId : null}
        previewName={preview?.name ?? null}
        onWatchLive={() => navigate(paths.live)}
        // The session goes along as the navigation's state, so the page needn't look it up (useRecordedSession).
        onResults={(s) => navigate(paths.results(s.id), { state: s })}
        onPreview={(e) => navigate(paths.event(e))}
      />
      {/* Settings: live and replay (same settings; opens on the layout of the session on screen). */}
      <SettingsPanel
        // Re-mount on open so it starts on the layout for the session on screen.
        key={settingsOpen ? 'open' : 'closed'}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        kind={isRace((replaying ? results?.type : timing?.session.type) ?? '') ? 'race' : 'timed'}
        columns={settings.columns}
        onColumns={(columns) => updateSettings({ columns })}
        focusCard={settings.focusCard}
        onFocusCard={(focusCard) => updateSettings({ focusCard })}
        cutoffLines={settings.cutoffLines}
        onCutoffLines={(cutoffLines) => updateSettings({ cutoffLines })}
        finalistBadges={settings.finalistBadges}
        onFinalistBadges={(finalistBadges) => updateSettings({ finalistBadges })}
      />
      {route.page === 'unknown' ? (
        <Navigate to={paths.live} replace />
      ) : route.page === 'event' ? (
        <main>
          {preview
            ? <EventPreview event={preview} onLive={() => navigate(paths.live)} />
            : <NotFound what="That event isn't in the calendar (it may be over)." onLive={() => navigate(paths.live)} />}
        </main>
      ) : route.page === 'results' ? (
        <main>
          {results === undefined ? <div className="empty">Loading…</div>
            : results === null ? <NotFound what="There's no recorded session with that link." onLive={() => navigate(paths.live)} />
            // Through the tunnel replays are off: the replay link shows the results instead.
            : replaying && replayAllowed
              ? <ReplayView session={results} onBack={() => navigate(paths.results(results.id), { state: results })} onUpdate={setReplayUpdate} onSettings={() => setSettingsOpen(true)} />
              : <ResultsView session={results} onLive={() => navigate(paths.live)}
                  onReplay={replayAllowed ? () => navigate(paths.replay(results.id), { state: results }) : undefined} />}
        </main>
      ) : (
        <>
          <Controls simple={settings.simple} onSimple={(simple) => updateSettings({ simple })} delay={settings.delay} buffered={buffered} onDelay={(delay) => updateSettings({ delay })} onSettings={() => setSettingsOpen(true)} />
          <main>
            {hasCars && update ? (
              <SessionView update={update} live={latest} settings={settings} updateSettings={updateSettings} togglePinned={togglePinned} tips />
            ) : (
              <EmptyState state={latest?.feed.state} detail={latest?.feed.detail} connection={connection} support={supportSession ? timing?.session.name : undefined}
                onOpenEvent={(e) => navigate(paths.event(e))} />
            )}
          </main>
        </>
      )}
      {/* In the live view the tips sit under the tower instead. */}
      {!(hasCars && live) && (
        <TipsPanel
          open={!settings.tipDismissed}
          onClose={() => updateSettings({ tipDismissed: true })}
          onOpen={() => updateSettings({ tipDismissed: false })}
        />
      )}
    </div>
  )
}

function NotFound({ what, onLive }: { what: string; onLive: () => void }) {
  return (
    <div className="empty">
      {what} <button type="button" className="link-button" onClick={onLive}>Back to live timing</button>
    </div>
  )
}

function EmptyState({ state, detail, connection, support, onOpenEvent }: {
  state?: string; detail?: string | null; connection: string; support?: string; onOpenEvent: (event: UpcomingEvent) => void
}) {
  // Between sessions: what's next and when (the server says when it will connect to the feed).
  if (connection === 'connected' && !support && state === 'waiting') return <NextSession detail={detail} onOpenEvent={onOpenEvent} />
  let message = 'Waiting for timing data…'
  if (connection !== 'connected') message = 'Connecting to the timing server…'
  else if (support) message = `A support category is on track (${support.replace(/^\d{4}\s+/, '').split(' - ')[0]}). Timing will appear here when the next Supercars session starts.`
  else if (isF1 && state === 'live') message = 'Connected to F1 live timing. Waiting for the session data…'
  // Between sessions the server isn't connected to Natsoft at all, and says when it will be (SessionSchedule).
  else if (state === 'waiting') message = `No session on track right now. Timing appears automatically when one starts.${detail?.startsWith('Not connected') ? ` ${detail}.` : ''}`
  else if (state === 'error') message = detail ?? 'The feed reported an error.'
  return <div className="empty">{message}</div>
}

/**
 * What the header shows when the page isn't live timing: the replay at its current moment, a recorded session's
 * results, or an upcoming event. null = live timing.
 */
function headerView(preview: UpcomingEvent | null, results: RecordedSession | null, replay: TimingUpdate | null) {
  const stopped = (meeting: string, name: string, track: string, trackCode = ''): TimingUpdate => ({
    feed: { mode: 'Replay', state: 'ended', detail: null, clockRate: 0 },
    timing: {
      session: { meeting, name, type: '', track, trackCode, flag: '', clockRemaining: null, clockElapsed: null, scheduledLaps: 0 },
      timingPoints: [], best: { lap: null, s1: null, s2: null, s3: null, speed: null }, cars: [], segmentReference: [], segmentBest: [], now: 0, messageCount: 0,
    },
  })
  if (preview) return { update: stopped(preview.name, 'Upcoming event', `${preview.venue} · ${preview.location}`), status: 'Upcoming', clock: false }
  if (results && replay) {
    const rate = replay.feed.clockRate
    return { update: replay, status: rate > 0 ? `Replay · ${rate}×` : 'Replay · paused', clock: true }
  }
  if (results) return { update: stopped(results.meeting, sessionLabel(results), results.track, results.trackCode), status: 'Results', clock: false }
  return null
}

/** "2026 Repco Supercars Championship - Race 32" -> "Race 32" (the session part of a recorded session's name). */
function sessionLabel(session: RecordedSession): string {
  const [series, ...rest] = session.name.replace(/^\d{4}\s+/, '').split(' - ')
  return rest.join(' - ') || series
}
