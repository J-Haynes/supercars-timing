import { useState } from 'react'
import { useTiming } from './useTiming'
import { useDelayedUpdate } from './useDelayedUpdate'
import { useSettings } from './settings'
import { SessionHeader } from './components/SessionHeader'
import { Controls } from './components/Controls'
import { TimingTower } from './components/TimingTower'
import { TrackMap } from './components/TrackMap'
import { TipsPanel } from './components/TipsPanel'
import { Menu } from './components/Menu'
import { ResultsView } from './components/ResultsView'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShootoutCard, pickFocusCar } from './components/ShootoutCard'
import { useTrack } from './tracks'
import { isShootout, isSupercarsSession } from './session'
import type { RecordedSession } from './types'

export default function App() {
  const { update: latest, connection } = useTiming()
  const { settings, update: updateSettings, togglePinned } = useSettings()
  // Everything below shows the delayed update, so the tower, map and clock stay in sync with the broadcast.
  const { update, buffered } = useDelayedUpdate(latest, settings.delay)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // null = live timing; otherwise the recorded session whose results are on screen.
  const [results, setResults] = useState<RecordedSession | null>(null)

  const timing = update?.timing
  // Support categories share the feed: only show Supercars Championship sessions.
  const supportSession = !!timing?.session.name && !isSupercarsSession(timing.session.name)
  const track = useTrack(timing?.session.trackCode || undefined, timing?.session.track)
  const hasCars = !!timing && timing.cars.length > 0 && !supportSession
  const rate = latest && (latest.feed.state === 'live' || latest.feed.state === 'replaying') ? latest.feed.clockRate ?? 1 : 0
  // The on-track card shows automatically for Shootout sessions (by Natsoft's session name), or when forced on.
  const showCard = !!timing && (settings.focusCard === 'on' || (settings.focusCard === 'auto' && isShootout(timing.session.name, timing.session.type)))
  const focusId = showCard && timing ? pickFocusCar(timing.cars, timing.now)?.id ?? null : null

  return (
    <div className="app">
      <SessionHeader update={update} feed={latest?.feed} connection={connection} onMenu={() => setMenuOpen(true)} hideSession={supportSession} />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        resultsId={results?.id ?? null}
        onWatchLive={() => setResults(null)}
        onResults={setResults}
      />
      {results ? (
        <main><ResultsView session={results} onLive={() => setResults(null)} /></main>
      ) : (
        <>
          <Controls
            simple={settings.simple}
            delay={settings.delay}
            buffered={buffered}
            onSimple={(simple) => updateSettings({ simple })}
            onDelay={(delay) => updateSettings({ delay })}
            focusCard={settings.focusCard}
            onFocusCard={(focusCard) => updateSettings({ focusCard })}
          />
          <main>
            {hasCars && update ? (
              <>
                {showCard && <ShootoutCard timing={timing} track={track} clockRate={rate} />}
                <div className="layout">
                  <TimingTower
                    timing={timing}
                    simple={settings.simple}
                    hoverId={hoverId}
                    pinned={settings.pinned}
                    onHover={setHoverId}
                    onTogglePin={togglePinned}
                  />
                  <aside className="map-panel">
                    {track ? (
                      <ErrorBoundary fallback={<div className="map-missing">The track map hit an error. Check the browser console.</div>}>
                        <TrackMap
                          track={track}
                          update={update}
                          hoverId={hoverId}
                          focusId={focusId}
                          pinned={settings.pinned}
                          rotation={settings.mapRotation[track.code] ?? 0}
                          onRotate={(deg) => updateSettings({ mapRotation: { ...settings.mapRotation, [track.code]: ((deg % 360) + 360) % 360 } })}
                          onHover={setHoverId}
                          onTogglePin={togglePinned}
                        />
                      </ErrorBoundary>
                    ) : (
                      <div className="map-missing">
                        No map for {timing.session.track || 'this track'} yet. Build one with <code>tools/TrackBuilder</code>.
                      </div>
                    )}
                  </aside>
                </div>
              </>
            ) : (
              <EmptyState state={latest?.feed.state} detail={latest?.feed.detail} connection={connection} support={supportSession ? timing?.session.name : undefined} />
            )}
          </main>
        </>
      )}
      <TipsPanel
        open={!settings.tipDismissed}
        onClose={() => updateSettings({ tipDismissed: true })}
        onOpen={() => updateSettings({ tipDismissed: false })}
      />
    </div>
  )
}

function EmptyState({ state, detail, connection, support }: { state?: string; detail?: string | null; connection: string; support?: string }) {
  let message = 'Waiting for timing data…'
  if (connection !== 'connected') message = 'Connecting to the timing server…'
  else if (support) message = `A support category is on track (${support.replace(/^\d{4}\s+/, '').split(' - ')[0]}). Timing will appear here when the next Supercars session starts.`
  else if (state === 'waiting') message = 'No session on track right now. Timing appears automatically when one starts.'
  else if (state === 'error') message = detail ?? 'The feed reported an error.'
  return <div className="empty">{message}</div>
}
