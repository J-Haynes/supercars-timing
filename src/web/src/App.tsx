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
import { ReplayBar } from './components/ReplayBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useTrack } from './tracks'
import { ShootoutCard, pickFocusCar } from './components/ShootoutCard'
import { isShootout } from './session'

export default function App() {
  const { update: latest, connection, controls } = useTiming()
  const { settings, update: updateSettings, togglePinned } = useSettings()
  const replay = latest?.replay ?? null
  // Everything below shows the delayed update, so the tower, map and clock stay in sync with the broadcast.
  // Replays aren't delayed.
  const { update, buffered } = useDelayedUpdate(latest, replay ? 0 : settings.delay)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const timing = update?.timing
  const track = useTrack(timing?.session.trackCode || undefined, timing?.session.track)
  const hasCars = !!timing && timing.cars.length > 0
  const rate = latest && (latest.feed.state === 'live' || latest.feed.state === 'replaying') ? latest.feed.clockRate ?? 1 : 0
  // The on-track card shows automatically for Shootout sessions (by Natsoft's session name), or when forced on.
  const showCard = !!timing && (settings.focusCard === 'on' || (settings.focusCard === 'auto' && isShootout(timing.session.name, timing.session.type)))
  const focusId = showCard && timing ? pickFocusCar(timing.cars, timing.now)?.id ?? null : null

  return (
    <div className="app">
      <SessionHeader update={update} feed={latest?.feed} connection={connection} onMenu={() => setMenuOpen(true)} />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        replayingId={replay?.sessionId ?? null}
        onWatchLive={controls.watchLive}
        onReplay={controls.startReplay}
      />
      {replay && (
        <ReplayBar replay={replay} onPlay={controls.play} onSeek={controls.seek} onSpeed={controls.speed} onLive={controls.watchLive} />
      )}
      <Controls
        simple={settings.simple}
        delay={settings.delay}
        buffered={buffered}
        replaying={!!replay}
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
          <EmptyState state={latest?.feed.state} detail={latest?.feed.detail} connection={connection} />
        )}
      </main>
      <TipsPanel
        open={!settings.tipDismissed}
        onClose={() => updateSettings({ tipDismissed: true })}
        onOpen={() => updateSettings({ tipDismissed: false })}
      />
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
