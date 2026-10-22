import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CarRow } from '../types'
import type { LapHistory, TimingUpdate } from '../types'
import type { MapFeed } from '../map/crossingLog'
import type { Settings } from '../settings'
import { useTrack } from '../tracks'
import { isRace, isShootout } from '../session'
import { isF1 } from '../series'
import { raceOrder } from '../liveGaps'
import { useChartSelection } from '../chartSelection'
import { useStickToBottom } from '../useStickToBottom'
import { usePitGhost } from '../pit/usePitGhost'
import { TimingTower } from './TimingTower'
import { DriverDialog, type DriverTab } from './DriverDialog'
import { MapView } from './MapView'
import { ColumnSplitter } from './ColumnSplitter'
import { TipsPanel } from './TipsPanel'
import { ErrorBoundary } from './ErrorBoundary'
import { ShootoutCard, pickFocusCar } from './ShootoutCard'
import { PitLog } from './PitLog'
import { RaceControl } from './RaceControl'
import { RaceFeed } from './RaceFeed'
import { useTowerSignals } from '../towerSignals'
import { Ladder } from './Ladder'
import { FinalsLadder } from './FinalsStandings'
import { RaceCharts } from './RaceCharts'
import { SafetyCarBanner } from './SafetyCarBanner'
import { MobileTabs, loadMobileTab, saveMobileTab, type MobileTab } from './MobileTabs'
import { StartCountdown } from './StartCountdown'
import { scheduledStart } from '../calendar'

/**
 * A session on screen, live or replayed: the race feed, tower, map, ladders, charts, race control and pit log, with
 * everything that joins them (hover and highlights, the driver dialog, the pit rejoin estimate shared by the tower
 * and the map, the chart selection, the phone tabs). The live page (App) and the replay page (ReplayView) both use
 * it, so a feature added here is in both: they used to be built separately and kept drifting apart.
 */
export function SessionView({ update, live, history, settings, updateSettings, togglePinned, resetKey, tips = false, startAt }: {
  /** What's shown (the delayed update live; the replay's moment in a replay). */
  update: TimingUpdate
  /** The map's view of what comes next: the live feed ahead of a broadcast delay, or a replay's lookahead. */
  live: MapFeed | null
  /** Lap history for the charts and the driver dialog: undefined = fetch the live one; a replay passes its laps up to
   * the replay time. */
  history?: LapHistory | null
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  togglePinned: (carNumber: string) => void
  /** Changes when the race feed should start again (a replay seeking backwards). */
  resetKey?: number
  /** The tips panel under the tower (live page). */
  tips?: boolean
  /** The race's green flag time when it's known in advance (a replay); live uses the timetable's start. */
  startAt?: number
}) {
  const { timing } = update
  const race = isRace(timing.session.type)
  const track = useTrack(timing.session.trackCode || undefined, timing.session.track)
  const rate = update.feed.state === 'live' || update.feed.state === 'replaying' ? update.feed.clockRate ?? 1 : 0
  const [hoverId, setHoverId] = useState<string | null>(null)
  // Cars named by the feed item under the mouse, highlighted in the tower and on the map.
  const [highlightIds, setHighlightIds] = useState<string[]>([])
  const [driverView, setDriverView] = useState<{ carId: string; compareId: string | null; tab: DriverTab } | null>(null)
  const [mobileTab, setMobileTab] = useState<MobileTab>(() => loadMobileTab())
  const towerColumn = useStickToBottom<HTMLDivElement>()
  // Cars on the race charts: shared by the charts panel and the tower's chart buttons. Starts with the top four.
  const chart = useChartSelection(race ? raceOrder(timing).slice(0, 4).map((c) => c.id) : [], `${timing.session.meeting}|${timing.session.name}`)
  // The pit rejoin estimate (experimental): one for the tower and the map.
  const ghost = usePitGhost(timing, track, settings.pitGhostCar)
  // Race signals (battles, undercuts, pit-adjusted order): one memory for the tower and the race feed.
  const signals = useTowerSignals(timing, [], timing.session.trackCode, resetKey)
  usePitGhostAutoOff(timing.cars, settings.pitGhostCar, () => updateSettings({ pitGhostCar: null }))
  // The on-track card shows automatically for Shootout sessions (by Natsoft's session name), or when forced on.
  const showCard = settings.focusCard === 'on' || (settings.focusCard === 'auto' && isShootout(timing.session.name, timing.session.type))
  const focusId = showCard ? pickFocusCar(timing.cars, timing.now)?.id ?? null : null
  const open = (carId: string, compareId: string | null = null) => setDriverView({ carId, compareId, tab: compareId ? 'compare' : 'focus' })

  return (
    <>
      {showCard && <ShootoutCard timing={timing} track={track} clockRate={rate} />}
      {race && <StartCountdown timing={timing} clockRate={rate} startAt={startAt ?? scheduledStart(timing.session)} exact={startAt !== undefined} />}
      <MobileTabs tab={mobileTab} race={race} onTab={(t) => { setMobileTab(t); saveMobileTab(t) }} />
      <div className={`layout${settings.simple ? ' simple' : ''}${settings.mapWidth ? ' sized' : ''}`} data-tab={mobileTab}
        style={settings.mapWidth ? { '--map-width': `${settings.mapWidth}px` } as CSSProperties : undefined}>
        <div className="tower-column" ref={towerColumn}>
          {race && <SafetyCarBanner timing={timing} />}
          {race && <RaceFeed key={resetKey} timing={timing} signals={signals} onHighlight={setHighlightIds} onOpen={open} />}
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
            onOpen={(carId) => open(carId)}
            actions={{ pitGhostCar: settings.pitGhostCar, onPitGhost: (pitGhostCar) => updateSettings({ pitGhostCar }), chart }}
            pitGhost={ghost}
            signals={signals}
          />
          {driverView && (
            <DriverDialog timing={timing} {...driverView} history={history} onClose={() => setDriverView(null)}
              onChange={(carId, compareId, tab) => setDriverView({ carId, compareId, tab })} />
          )}
          {tips && (
            <TipsPanel open={!settings.tipDismissed} onClose={() => updateSettings({ tipDismissed: true })}
              onOpen={() => updateSettings({ tipDismissed: false })} />
          )}
        </div>
        <ColumnSplitter width={settings.mapWidth} onWidth={(mapWidth) => updateSettings({ mapWidth })} />
        <aside className="map-panel">
          <div className="panel-map">
            {track ? (
              <ErrorBoundary fallback={<div className="map-missing">The track map hit an error. Check the browser console.</div>}>
                <MapView settings={settings} onSettings={updateSettings} ghost={ghost}
                  track={track}
                  update={update}
                  live={live}
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
            {/* Supercars championship and Finals ladders (this season's only): no F1 standings yet. */}
            {!isF1 && <Ladder timing={timing} onHighlight={setHighlightIds} />}
            {!isF1 && <FinalsLadder timing={timing} onHighlight={setHighlightIds} />}
          </div>
          <div className="panel-charts">
            {race && <RaceCharts timing={timing} history={history} selection={chart} />}
          </div>
          <div className="panel-race">
            {(timing.raceControl?.length || timing.session.lapRecord) ? <RaceControl timing={timing} /> : null}
            {race && <PitLog timing={timing} />}
          </div>
        </aside>
      </div>
    </>
  )
}

/**
 * Turns the pit rejoin estimate off once the car has made the stop: after it has left the pits and crossed its first
 * timing point since (its real place in the field is known then; the undercut tags use the same moment). Not at pit
 * entry: during the stop is when the estimate is worth comparing with what happens.
 */
function usePitGhostAutoOff(cars: CarRow[], carNumber: string | null, turnOff: () => void) {
  const car = carNumber ? cars.find((c) => c.carNumber === carNumber) : undefined
  const done = (c: CarRow) => c.pitLog.filter((s) => s.outAt > 0).length
  // Stops the car had made when it was picked (or when this page first saw it picked).
  const picked = useRef<{ carNumber: string; stops: number } | null>(null)
  if (car && picked.current?.carNumber !== car.carNumber) picked.current = { carNumber: car.carNumber, stops: done(car) }
  if (!carNumber) picked.current = null
  const finished = !!car && !!picked.current && done(car) > picked.current.stops && !car.inPit
    && car.lastPointAt > (car.pitLog.at(-1)?.outAt ?? Infinity)
  useEffect(() => { if (finished) turnOff() }, [finished]) // eslint-disable-line react-hooks/exhaustive-deps -- turnOff is a fresh closure
}
