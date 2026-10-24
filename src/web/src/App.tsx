import { useState } from 'react'
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
import { useFeatures } from './features'

export default function App() {
  const { update: latest, connection } = useTiming()
  const { settings, update: updateSettings, togglePinned } = useSettings()
  // Everything below shows the delayed update, so the tower, map and clock stay in sync with the broadcast.
  const { update, buffered } = useDelayedUpdate(latest, settings.delay)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // null = live timing; otherwise the recorded session whose results are on screen.
  const [results, setResults] = useState<RecordedSession | null>(null)
  // An upcoming event's page (timetable and map), opened from the menu.
  const [preview, setPreview] = useState<UpcomingEvent | null>(null)
  // Replaying the results session (from its results page).
  const [replaying, setReplaying] = useState(false)
  // The replay's current moment, reported by ReplayView, for the header.
  const [replayUpdate, setReplayUpdate] = useState<TimingUpdate | null>(null)
  // Replays are local only: not offered through the Cloudflare Tunnel (features.ts).
  const { replay: replayAllowed } = useFeatures()

  const timing = update?.timing
  // Support categories share the feed: only show Supercars Championship sessions.
  const supportSession = !isF1 && !!timing?.session.name && !isSupercarsSession(timing.session.name)
  const hasCars = !!timing && timing.cars.length > 0 && !supportSession
  // Red / yellow (safety car, full-course yellow) flags frame the whole screen while they're out.
  const kind = !results && !supportSession && timing ? flagKind(timing.session.flag) : undefined
  const frame = kind === 'red' ? ' flag-frame flag-frame-red' : kind === 'caution' ? ' flag-frame flag-frame-yellow' : ''

  return (
    <div className={`app${frame}`}>
      <SessionHeader update={update} feed={latest?.feed} connection={connection} onMenu={() => setMenuOpen(true)} hideSession={supportSession}
        viewing={headerView(preview, results, replaying ? replayUpdate : null)} />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        resultsId={results?.id ?? null}
        onWatchLive={() => { setResults(null); setPreview(null); setReplaying(false) }}
        onResults={(s) => { setResults(s); setPreview(null); setReplaying(false) }}
        onPreview={(e) => { setPreview(e); setResults(null) }}
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
      {preview ? (
        <main><EventPreview event={preview} onLive={() => setPreview(null)} /></main>
      ) : results && replaying && replayAllowed ? (
        <main><ReplayView session={results} onBack={() => setReplaying(false)} onUpdate={setReplayUpdate} onSettings={() => setSettingsOpen(true)} /></main>
      ) : results ? (
        <main><ResultsView session={results} onLive={() => setResults(null)} onReplay={replayAllowed ? () => setReplaying(true) : undefined} /></main>
      ) : (
        <>
          <Controls simple={settings.simple} onSimple={(simple) => updateSettings({ simple })} delay={settings.delay} buffered={buffered} onDelay={(delay) => updateSettings({ delay })} onSettings={() => setSettingsOpen(true)} />
          <main>
            {hasCars && update ? (
              <SessionView update={update} live={latest} settings={settings} updateSettings={updateSettings} togglePinned={togglePinned} tips />
            ) : (
              <EmptyState state={latest?.feed.state} detail={latest?.feed.detail} connection={connection} support={supportSession ? timing?.session.name : undefined}
                onOpenEvent={setPreview} />
            )}
          </main>
        </>
      )}
      {/* In the live view the tips sit under the tower instead. */}
      {!(hasCars && !results) && (
        <TipsPanel
          open={!settings.tipDismissed}
          onClose={() => updateSettings({ tipDismissed: true })}
          onOpen={() => updateSettings({ tipDismissed: false })}
        />
      )}
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
  if (results) {
    const [series, ...rest] = results.name.replace(/^\d{4}\s+/, '').split(' - ')
    return { update: stopped(results.meeting, rest.join(' - ') || series, results.track, results.trackCode), status: 'Results', clock: false }
  }
  return null
}
