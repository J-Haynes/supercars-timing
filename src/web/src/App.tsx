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
import { EventPreview } from './components/EventPreview'
import { ReplayView } from './components/ReplayView'
import type { UpcomingEvent } from './calendar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShootoutCard, pickFocusCar } from './components/ShootoutCard'
import { PitLog } from './components/PitLog'
import { RaceControl } from './components/RaceControl'
import { InsightsTicker } from './components/InsightsTicker'
import { Ladder } from './components/Ladder'
import { FinalsLadder } from './components/FinalsLadder'
import { RaceCharts } from './components/RaceCharts'
import { SettingsPanel } from './components/SettingsPanel'
import { useTrack } from './tracks'
import { useStickToBottom } from './useStickToBottom'
import { MobileTabs, loadMobileTab, saveMobileTab, type MobileTab } from './components/MobileTabs'
import { flagKind, isRace, isShootout, isSupercarsSession } from './session'
import { SafetyCarBanner } from './components/SafetyCarBanner'
import type { RecordedSession } from './types'
import { isF1 } from './series'

export default function App() {
  const { update: latest, connection } = useTiming()
  const { settings, update: updateSettings, togglePinned } = useSettings()
  // Everything below shows the delayed update, so the tower, map and clock stay in sync with the broadcast.
  const { update, buffered } = useDelayedUpdate(latest, settings.delay)
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Cars named by the insight under the mouse, highlighted in the tower and on the map.
  const [highlightIds, setHighlightIds] = useState<string[]>([])
  const towerColumn = useStickToBottom<HTMLDivElement>()
  // Phone layout: which section the tab bar shows (desktop shows everything).
  const [mobileTab, setMobileTab] = useState<MobileTab>(() => loadMobileTab())
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // null = live timing; otherwise the recorded session whose results are on screen.
  const [results, setResults] = useState<RecordedSession | null>(null)
  // An upcoming event's page (timetable and map), opened from the menu.
  const [preview, setPreview] = useState<UpcomingEvent | null>(null)
  // Replaying the results session (from its results page).
  const [replaying, setReplaying] = useState(false)

  const timing = update?.timing
  // Support categories share the feed: only show Supercars Championship sessions.
  const supportSession = !isF1 && !!timing?.session.name && !isSupercarsSession(timing.session.name)
  const track = useTrack(timing?.session.trackCode || undefined, timing?.session.track)
  const hasCars = !!timing && timing.cars.length > 0 && !supportSession
  const rate = latest && (latest.feed.state === 'live' || latest.feed.state === 'replaying') ? latest.feed.clockRate ?? 1 : 0
  // The on-track card shows automatically for Shootout sessions (by Natsoft's session name), or when forced on.
  const showCard = !!timing && (settings.focusCard === 'on' || (settings.focusCard === 'auto' && isShootout(timing.session.name, timing.session.type)))
  const focusId = showCard && timing ? pickFocusCar(timing.cars, timing.now)?.id ?? null : null
  // Red / yellow (safety car, full-course yellow) flags frame the whole screen while they're out.
  const kind = !results && !supportSession && timing ? flagKind(timing.session.flag) : undefined
  const frame = kind === 'red' ? ' flag-frame flag-frame-red' : kind === 'caution' ? ' flag-frame flag-frame-yellow' : ''

  return (
    <div className={`app${frame}`}>
      <SessionHeader update={update} feed={latest?.feed} connection={connection} onMenu={() => setMenuOpen(true)} hideSession={supportSession} />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        resultsId={results?.id ?? null}
        onWatchLive={() => { setResults(null); setPreview(null); setReplaying(false) }}
        onResults={(s) => { setResults(s); setPreview(null); setReplaying(false) }}
        onPreview={(e) => { setPreview(e); setResults(null) }}
      />
      {preview ? (
        <main><EventPreview event={preview} onLive={() => setPreview(null)} /></main>
      ) : results && replaying ? (
        <main><ReplayView session={results} onBack={() => setReplaying(false)} /></main>
      ) : results ? (
        <main><ResultsView session={results} onLive={() => setResults(null)} onReplay={() => setReplaying(true)} /></main>
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
            onSettings={() => setSettingsOpen(true)}
          />
          <SettingsPanel
            // Re-mount on open so it starts on the layout for the session on screen.
            key={settingsOpen ? 'open' : 'closed'}
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            kind={timing && isRace(timing.session.type) ? 'race' : 'timed'}
            columns={settings.columns}
            onColumns={(columns) => updateSettings({ columns })}
          />
          <main>
            {hasCars && update ? (
              <>
                {showCard && <ShootoutCard timing={timing} track={track} clockRate={rate} />}
                <MobileTabs tab={mobileTab} race={isRace(timing.session.type)} onTab={(t) => { setMobileTab(t); saveMobileTab(t) }} />
                <div className={settings.simple ? 'layout simple' : 'layout'} data-tab={mobileTab}>
                  <div className="tower-column" ref={towerColumn}>
                  {isRace(timing.session.type) && <SafetyCarBanner timing={timing} />}
                  {isRace(timing.session.type) && <InsightsTicker timing={timing} onHighlight={setHighlightIds} />}
                  <TimingTower
                    timing={timing}
                    simple={settings.simple}
                    columnPrefs={settings.columns}
                    hoverId={hoverId}
                    highlightIds={highlightIds}
                    clockRate={rate}
                    pinned={settings.pinned}
                    onHover={setHoverId}
                    onTogglePin={togglePinned}
                  />
                  <TipsPanel
                    open={!settings.tipDismissed}
                    onClose={() => updateSettings({ tipDismissed: true })}
                    onOpen={() => updateSettings({ tipDismissed: false })}
                  />
                  </div>
                  <aside className="map-panel">
                    <div className="panel-map">
                    {track ? (
                      <ErrorBoundary fallback={<div className="map-missing">The track map hit an error. Check the browser console.</div>}>
                        <TrackMap
                          track={track}
                          update={update}
                          live={latest}
                          hoverId={hoverId}
                          highlightIds={highlightIds}
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
                        No map for {timing.session.track || 'this track'} yet. Build one with <code>{isF1 ? 'tools/F1TrackBuilder' : 'tools/TrackBuilder'}</code>.
                      </div>
                    )}
                    </div>
                    <div className="panel-race">
                      {/* Supercars championship and Finals ladders: no F1 standings yet. */}
                      {!isF1 && <Ladder timing={timing} onHighlight={setHighlightIds} />}
                      {!isF1 && isRace(timing.session.type) && <FinalsLadder timing={timing} onHighlight={setHighlightIds} />}
                    </div>
                    <div className="panel-charts">
                      {isRace(timing.session.type) && <RaceCharts timing={timing} />}
                    </div>
                    <div className="panel-race">
                      {(timing.raceControl?.length || timing.session.lapRecord) ? <RaceControl timing={timing} /> : null}
                      {isRace(timing.session.type) && <PitLog timing={timing} />}
                    </div>
                  </aside>
                </div>
              </>
            ) : (
              <EmptyState state={latest?.feed.state} detail={latest?.feed.detail} connection={connection} support={supportSession ? timing?.session.name : undefined} />
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

function EmptyState({ state, detail, connection, support }: { state?: string; detail?: string | null; connection: string; support?: string }) {
  let message = 'Waiting for timing data…'
  if (connection !== 'connected') message = 'Connecting to the timing server…'
  else if (support) message = `A support category is on track (${support.replace(/^\d{4}\s+/, '').split(' - ')[0]}). Timing will appear here when the next Supercars session starts.`
  else if (isF1 && state === 'live') message = 'Connected to F1 live timing. Waiting for the session data…'
  else if (state === 'waiting') message = 'No session on track right now. Timing appears automatically when one starts.'
  else if (state === 'error') message = detail ?? 'The feed reported an error.'
  return <div className="empty">{message}</div>
}
