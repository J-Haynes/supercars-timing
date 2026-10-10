import { useState } from 'react'
import { useTiming } from './useTiming'
import { useDelayedUpdate } from './useDelayedUpdate'
import { useSettings } from './settings'
import { SessionHeader } from './components/SessionHeader'
import { Controls } from './components/Controls'
import { TimingTower } from './components/TimingTower'
import { TrackMap } from './components/TrackMap'
import { TipBar } from './components/TipBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useTrack } from './tracks'

export default function App() {
  const { update: latest, connection } = useTiming()
  const { settings, update: updateSettings, togglePinned } = useSettings()
  // Everything below shows the delayed update, so the tower, map and clock stay in sync with the broadcast.
  const { update, buffered } = useDelayedUpdate(latest, settings.delay)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const timing = update?.timing
  const track = useTrack(timing?.session.trackCode || undefined)
  const hasCars = !!timing && timing.cars.length > 0

  return (
    <div className="app">
      <SessionHeader update={update} feed={latest?.feed} connection={connection} />
      <Controls
        simple={settings.simple}
        delay={settings.delay}
        buffered={buffered}
        onSimple={(simple) => updateSettings({ simple })}
        onDelay={(delay) => updateSettings({ delay })}
      />
      <main>
        {hasCars && update ? (
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
                    pinned={settings.pinned}
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
        ) : (
          <EmptyState state={latest?.feed.state} detail={latest?.feed.detail} connection={connection} />
        )}
      </main>
      {!settings.tipDismissed && <TipBar onDismiss={() => updateSettings({ tipDismissed: true })} />}
    </div>
  )
}

function EmptyState({ state, detail, connection }: { state?: string; detail?: string | null; connection: string }) {
  let message = 'Waiting for timing data…'
  if (connection !== 'connected') message = 'Connecting to the timing server…'
  else if (state === 'waiting') message = 'No session on track right now. Timing appears automatically when one starts.'
  else if (state === 'error') message = detail ?? 'The feed reported an error.'
  return <div className="empty">{message}</div>
}
