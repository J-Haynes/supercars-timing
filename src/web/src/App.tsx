import { useState } from 'react'
import { useTiming } from './useTiming'
import { SessionHeader } from './components/SessionHeader'
import { TimingTower } from './components/TimingTower'
import { TrackMap } from './components/TrackMap'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useTrack } from './tracks'

export default function App() {
  const { update, connection } = useTiming()
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const timing = update?.timing
  const track = useTrack(timing?.session.trackCode || undefined)
  const hasCars = !!timing && timing.cars.length > 0

  return (
    <div className="app">
      <SessionHeader update={update} connection={connection} />
      <main>
        {hasCars && update ? (
          <div className="layout">
            <TimingTower timing={timing} highlightId={highlightId} onHighlight={setHighlightId} />
            <aside className="map-panel">
              {track ? (
                <ErrorBoundary fallback={<div className="map-missing">The track map hit an error. Check the browser console.</div>}>
                  <TrackMap track={track} update={update} highlightId={highlightId} onHighlight={setHighlightId} />
                </ErrorBoundary>
              ) : (
                <div className="map-missing">
                  No map for {timing.session.track || 'this track'} yet. Build one with <code>tools/TrackBuilder</code>.
                </div>
              )}
            </aside>
          </div>
        ) : (
          <EmptyState state={update?.feed.state} detail={update?.feed.detail} connection={connection} />
        )}
      </main>
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
