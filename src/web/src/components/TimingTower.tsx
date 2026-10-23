import { isF1, teamStyle } from '../series'
import type { ReactNode } from 'react'
import type { CarRow, TimingSnapshot } from '../types'
import { gapText, lapTime, seconds, timeClass } from '../format'
import { MiniSectors } from './MiniSectors'
import { finishedCars, isRace, minDriverLaps, raceLaps } from '../session'
import { visibleColumns, type ColumnPrefs, type SessionKind } from '../towerLayout'
import { startPosition } from '../startingGrid'
import { carPenalties } from '../penalties'
import { liveGap, parkedAtLine, raceFinished, raceOrder } from '../liveGaps'
import { useRowMoves } from './useRowMoves'
import { useSessionClock } from '../map/useSessionClock'
import type { ChartSelection } from '../chartSelection'
import type { TowerSignals } from '../towerSignals'
import type { PitGhost } from '../pit/usePitGhost'
import { PHONE, useMediaQuery } from '../useMediaQuery'

/** Per-row buttons on the live race tower (shown on hover): pit rejoin estimate and the race charts. */
export interface RowActionProps {
  /** Car number whose pit rejoin estimate is on (settings.pitGhostCar). */
  pitGhostCar: string | null
  onPitGhost: (carNumber: string | null) => void
  /** The race charts' selection; no chart button without it (the replay page has no charts). */
  chart?: ChartSelection
}

interface Ctx {
  car: CarRow
  order: string[]
  segmentBest: number[]
  now: number
  simple: boolean
  isFirst: boolean
  /** Position shown: road order in races (see roadOrder), Natsoft's otherwise. */
  rank: number
  /** The race has finished (chequered flag): show official positions and gaps. */
  finished: boolean
  /** Race leader and the car ahead, for live gaps. */
  leader?: CarRow
  ahead?: CarRow
  race: boolean
  best: TimingSnapshot['best']
  points: TimingSnapshot['timingPoints']
  session: TimingSnapshot['session']
  timing: TimingSnapshot
  /** Session seconds per real second (1 live, replay speed, 0 when stopped), for the smooth pit timer. */
  clockRate: number
  /** Minimum laps per driver (0 = no rule) and laps left in the race (0 = unknown). */
  minLaps: number
  lapsLeft: number
  /** Opens the driver's Focus view (DriverDialog). */
  onOpen?: (id: string) => void
  actions?: RowActionProps
  /** Battles, the pit-adjusted leader and undercuts (towerSignals.ts). */
  signals: TowerSignals
  /** The pit rejoin estimate on screen (pit/usePitGhost.ts), shared with the map. */
  pitGhost: PitGhost | null
  /** Practice/qualifying/Shootout: the car has taken the chequered flag (finishedCars in session.ts). */
  chequered: boolean
}

interface Column {
  key: string
  header: string
  numeric?: boolean
  /** Extra class on header and cells, e.g. to emphasise the column that ranks the session. */
  className?: (race: boolean) => string
  cell: (c: Ctx) => ReactNode
  /** Cell class (colours etc.). Values whose cell should flash when they change return a key too. */
  cellClass?: (c: Ctx) => string
  flashKey?: (c: Ctx) => string | number
}

// GI/GNI in every session type. In races they match Natsoft's running order, whereas the LGI/LGNI fields
// often disagree with it (checked against the SuperUte race, Bathurst 2026). In practice and qualifying
// GI is the gap to the fastest lap.
const surname = (name: string) => name.split(' ').slice(1).join(' ') || name

// Races: live gaps at every timing point (liveGaps.ts), falling back to Natsoft's for lapped cars or when we can't
// tell (e.g. just out of the pits). Practice/qualifying: GI is the gap to the fastest lap, so it stays as is.
const gapOf = (c: Ctx) => {
  const { car } = c
  // F1's gaps and intervals are already live (updated through the lap), so use them as they are.
  if (isF1) return { gap: car.gap, laps: car.gapLaps, int: car.interval, intLaps: car.intervalLaps, status: car.inPit ? 'PIT' : '' }
  // Practice/qualifying, and races once finished: Natsoft's official gaps (live ones would follow the cool-down lap).
  if (!c.race || c.finished) return { gap: car.gap, laps: car.gapLaps, int: car.interval, intLaps: car.intervalLaps, status: '' }
  // In the pit lane, or out of it but not yet at a timing point: no meaningful gap until the next point.
  const status = car.inPit ? 'PIT' : parkedAtLine(car) ? 'OUT' : ''
  const gap = car.gapLaps === 0 && c.leader ? liveGap(car, c.leader, c.order) : null
  const int = car.intervalLaps === 0 && c.ahead ? liveGap(car, c.ahead, c.order) : null
  // Fallback: Natsoft's per-timing-point gaps (LGI/LGNI follow the road order), not the once-a-lap GI/GNI.
  const liveOk = car.liveGapLaps === 0 && car.liveGap > 0
  return {
    gap: gap ?? (liveOk ? car.liveGap : car.gap), laps: car.gapLaps,
    int: int ?? (car.liveIntervalLaps === 0 && car.liveInterval > 0 ? car.liveInterval : car.interval), intLaps: car.intervalLaps,
    status,
  }
}

const COLUMNS: Record<string, Column> = {
  pos: { key: 'pos', header: 'Pos', numeric: true, cell: ({ rank }) => rank || '', cellClass: () => 'pos' },
  posChange: {
    key: 'posChange', header: '+/−', numeric: true,
    cell: ({ car, session, rank }) => {
      const start = startPosition(session, car)
      if (!start || !rank) return ''
      const change = start - rank
      const title = `Started P${start}`
      if (change > 0) return <span className="pos-up" title={title}>▲{change}</span>
      if (change < 0) return <span className="pos-down" title={title}>▼{-change}</span>
      return <span className="pos-same" title={title}>–</span>
    },
  },
  car: {
    key: 'car', header: 'Car',
    cell: ({ car }) => <span className={`car mfr-${car.manufacturer.toLowerCase()}`} style={teamStyle(car)} title={car.vehicle}>{car.carNumber}</span>,
  },
  tyre: {
    key: 'tyre', header: 'Tyre',
    // F1 only: compound initial and laps on the set (TimingAppData stints).
    cell: ({ car }) => car.tyre ? <span className={`tyre tyre-${car.tyre.toLowerCase()}`} title={`${car.tyre} · ${car.tyreLaps ?? 0} laps`}>{car.tyre[0]}<small>{car.tyreLaps ?? ''}</small></span> : null,
  },
  driver: {
    key: 'driver', header: 'Driver', cellClass: () => 'driver',
    cell: ({ car, now, simple, race, best, timing, clockRate, onOpen, actions, signals, pitGhost, chequered }) => {
      // Co-driver events: name the driver in the car, with the other driver alongside in detailed mode.
      const others = (car.drivers ?? []).filter((d) => d && d !== car.driver)
      const swapped = car.driverChangedAt > 0 && now - car.driverChangedAt < 180
      return (
        <>
          <DriverMarker car={car} />
          {onOpen
            ? <button type="button" className="driver-open" onClick={() => onOpen(car.id)} onDoubleClick={(e) => e.stopPropagation()}
                title="Driver focus: laps, sectors, stints, pit stops, and compare with another car">{car.driver}</button>
            : car.driver}
          {!simple && others.length > 0 && <span className="co-driver"> / {others.map(surname).join(', ')}</span>}
          {swapped && <span className="swap-badge" title="Driver change">SWAP</span>}
          {chequered && <span className="chequer-badge" title="Finished: crossed the line after the chequered flag" aria-label="Finished"><ChequerIcon /></span>}
          {/* Races only: in practice and qualifying the fastest lap is simply P1. */}
          {race && !!best.lap && Math.abs(car.bestLap - best.lap) < 0.0005 && (
            <span className="fastest-badge" title={`Fastest lap: ${lapTime(car.bestLap)}`} aria-label="Fastest lap"><StopwatchIcon /></span>
          )}
          {/* Served penalties leave the tower; race control logs them as served. */}
          {carPenalties(car, timing).filter((p) => !p.servedAt).map((p, i) => (
            <span key={i} className="penalty-badge"
              title={`${p.kind === 'plp' ? 'Pit lane penalty (drive-through)' : `Penalty: ${p.what}`}${p.reason ? `: ${p.reason}` : ''} (not served yet)`}>
              {penaltyBadge(p.what)}
            </span>
          ))}
          <PitTimer car={car} serverNow={now} rate={clockRate} />
          <SignalBadges car={car} signals={signals} />
          {pitGhost?.car.id === car.id && <GhostTag ghost={pitGhost} />}
          {actions && <RowActions car={car} actions={actions} />}
        </>
      )
    },
  },
  best: {
    key: 'best', header: 'Best', numeric: true,
    // In practice/qualifying the best lap *is* the result, so make it the most prominent column.
    className: (race) => (race ? '' : 'primary'),
    cell: ({ car }) => lapTime(car.bestLap),
    cellClass: ({ car, best }) => (timeClass(car.bestLap, car.bestLap, best.lap) === 'session-best' ? 'session-best' : ''),
    flashKey: ({ car }) => car.bestLap,
  },
  gap: {
    key: 'gap', header: 'Gap', numeric: true,
    className: (race) => (race ? 'primary' : ''),
    cell: (c) => { const g = gapOf(c); return g.status && !c.isFirst ? <span className="gap-status">{g.status}</span> : gapText(g.gap, g.laps, c.isFirst) },
  },
  int: {
    key: 'int', header: 'Int', numeric: true,
    cell: (c) => {
      const g = gapOf(c)
      if (c.isFirst || g.status) return ''
      if (g.intLaps > 0) return `+${g.intLaps}L`
      const s = seconds(g.int)
      return s && `+${s}`
    },
    // In a battle with the car ahead (towerSignals): the interval in the maps' battle colour.
    cellClass: ({ car, signals }) => { const r = signals.battle.get(car.id); return r === 'mid' || r === 'last' ? 'battle-int' : '' },
  },
  last: {
    key: 'last', header: 'Last', numeric: true,
    cell: ({ car }) => lapTime(car.lastLap),
    cellClass: ({ car, best }) => timeClass(car.lastLap, car.bestLap, best.lap),
    flashKey: ({ car }) => car.lastLap,
  },
  s1: {
    key: 's1', header: 'S1', numeric: true, cell: ({ car }) => seconds(car.s1),
    cellClass: ({ car, best }) => timeClass(car.s1, car.bestS1, best.s1), flashKey: ({ car }) => car.s1,
  },
  s2: {
    key: 's2', header: 'S2', numeric: true, cell: ({ car }) => seconds(car.s2),
    cellClass: ({ car, best }) => timeClass(car.s2, car.bestS2, best.s2), flashKey: ({ car }) => car.s2,
  },
  s3: {
    key: 's3', header: 'S3', numeric: true, cell: ({ car }) => seconds(car.s3),
    cellClass: ({ car, best }) => timeClass(car.s3, car.bestS3, best.s3), flashKey: ({ car }) => car.s3,
  },
  speed: {
    key: 'speed', header: 'Speed', numeric: true, cell: ({ car }) => car.speed || '',
    cellClass: ({ car, best }) => (best.speed && car.speed === best.speed ? 'session-best' : ''),
  },
  pits: { key: 'pits', header: 'Pits', numeric: true, cell: ({ car }) => car.pitStops || '' },
  laps: { key: 'laps', header: 'Laps', numeric: true, cell: ({ car }) => car.laps || '' },
  stint: {
    key: 'stint', header: 'Stint', numeric: true,
    cell: ({ car }) => (car.inPit ? '' : car.stintLaps || ''),
  },
  driverLaps: {
    key: 'driverLaps', header: 'Driver laps', cellClass: () => 'driver-laps',
    cell: ({ car, minLaps, lapsLeft }) => <DriverLaps car={car} minLaps={minLaps} lapsLeft={lapsLeft} />,
  },
  minis: { key: 'minis', header: 'Mini-sectors', cell: ({ car, order, segmentBest }) => <MiniSectors car={car} order={order} sessionBest={segmentBest} /> },
}

/**
 * Who's in a shared car, as on the TV graphics: a hollow white circle for the primary (full-time) driver, a green
 * dot for the co-driver. Natsoft's driver 1 is the full-time driver in every Bathurst 2026 entry.
 */
function DriverMarker({ car }: { car: CarRow }) {
  if ((car.drivers?.length ?? 0) < 2) return null
  const primary = car.driverIndex === '1'
  return (
    <span
      className={`driver-marker ${primary ? 'primary' : 'co-driver'}`}
      title={primary ? 'Primary driver in the car' : 'Co-driver in the car'}
      aria-label={primary ? 'Primary driver' : 'Co-driver'}
    />
  )
}

/**
 * Pit rejoin and chart buttons for a row. They appear over the end of the driver cell while the row is hovered or has
 * focus (no layout shift); a car that's on either keeps a small mark beside its name: a violet dashed ring like the
 * ghost on the map, and a bar in its chart colour.
 */
function RowActions({ car, actions }: { car: CarRow; actions: RowActionProps }) {
  const ghostOn = actions.pitGhostCar === car.carNumber
  const chart = actions.chart
  const chartOn = !!chart?.selected.includes(car.id)
  const color = chartOn ? chart!.colorOf(car.id) : undefined
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <>
      {(ghostOn || chartOn) && (
        <span className="row-marks" aria-hidden>
          {ghostOn && <span className="row-mark-ghost" title="Pit rejoin estimate on the map" />}
          {chartOn && <span className="row-mark-chart" style={{ background: color }} title="On the race charts" />}
        </span>
      )}
      <span className="row-actions" onDoubleClick={stop}>
        <button type="button" className={`row-action ghost${ghostOn ? ' on' : ''}`} aria-pressed={ghostOn}
          onClick={(e) => { stop(e); actions.onPitGhost(ghostOn ? null : car.carNumber) }}
          title={ghostOn ? 'Hide the pit rejoin estimate' : `Pit rejoin: where #${car.carNumber} would rejoin if it pitted now (experimental estimate)`}>
          <span className="row-action-ring" aria-hidden />
          <span className="visually-hidden">Pit rejoin estimate for #{car.carNumber}</span>
        </button>
        {chart && <button type="button" className={`row-action chart${chartOn ? ' on' : ''}`} aria-pressed={chartOn}
          style={color ? { color, borderColor: color } : undefined}
          onClick={(e) => { stop(e); chart.toggle(car.id) }}
          title={chartOn ? 'Take off the race charts' : `Add #${car.carNumber} to the race charts`}>
          <ChartIcon />
          <span className="visually-hidden">{chartOn ? 'Remove from' : 'Add to'} the race charts</span>
        </button>}
      </span>
    </>
  )
}

/** A small line chart; uses the text colour (the car's chart colour once it's on). */
function ChartIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
      <path d="M1.5 14.5h13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".55" />
      <path d="M2 11l4-4.5 3 2.5 5-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Soft race signals beside the name (towerSignals.ts, estimates): "net P1" for the pit-adjusted leader while it isn't
 * the road leader, and an undercut tag: "UC #19 +1.2" = would be 1.2 s ahead of #19 if #19 stopped now (green if
 * ahead, amber if not), then "UC ✓" / "UC ✗" for a minute once #19 has stopped.
 */
function SignalBadges({ car, signals }: { car: CarRow; signals: TowerSignals }) {
  const uc = signals.undercut.get(car.id)
  const net = signals.netLeader?.id === car.id ? signals.netLeader : null
  return (
    <>
      {net && (
        <span className="net-badge" title={`Pit-adjusted leader (estimate): if every car had made the same number of stops, #${car.carNumber} would lead by about ${net.margin.toFixed(1)} s. Uses the estimated cost of a stop (pit rejoin estimate).`}>
          net P1
        </span>
      )}
      {uc && (
        <span className={`uc-badge ${uc.state === 'pending' ? (uc.margin >= 0 ? 'ahead' : 'behind') : uc.state}`}
          title={uc.state === 'pending'
            ? `Undercut on #${uc.target.carNumber} ${uc.target.driver} (estimate): if #${uc.target.carNumber} stopped now, #${car.carNumber} would be about ${Math.abs(uc.margin).toFixed(1)} s ${uc.margin >= 0 ? 'ahead' : 'behind'}.`
            : `Undercut on #${uc.target.carNumber} ${uc.target.driver} ${uc.state === 'worked' ? 'worked' : 'didn\'t work'}: ${Math.abs(uc.margin).toFixed(1)} s ${uc.margin >= 0 ? 'ahead' : 'behind'} after both stopped.`}>
          {uc.state === 'pending' ? `UC #${uc.target.carNumber} ${uc.margin >= 0 ? '+' : '−'}${Math.abs(uc.margin).toFixed(1)}` : uc.state === 'worked' ? 'UC ✓' : 'UC ✗'}
        </span>
      )}
    </>
  )
}

/** On the row of the car with the pit rejoin estimate on: where it would rejoin (the map shows the same). */
function GhostTag({ ghost }: { ghost: PitGhost }) {
  const r = ghost.rejoin
  const text = ghost.status === 'ok' && r ? `PIT → P${r.position}` : ghost.status === 'caution' ? 'PIT · paused' : ghost.status === 'in-pit' ? 'PIT · in pits' : null
  if (!text) return null
  const title = ghost.status === 'ok' && r
    ? `If #${ghost.car.carNumber} pitted now it would rejoin P${r.position}${r.best !== r.worst ? ` (likely P${r.best}–P${r.worst})` : ''}. Experimental estimate: see the card under the map.`
    : ghost.status === 'caution' ? 'Pit rejoin estimate paused under the safety car (a stop costs far less, not enough measured)' : 'In the pits now'
  return <span className="ghost-tag" title={title}>{text}</span>
}

/** How long the final pit-lane time stays on the badge after the car leaves. */
const PIT_RESULT_SECONDS = 8

/**
 * Pit badge with a smooth timer. While the car is in the pit lane it counts up from the server's pit-in time,
 * driven by the session clock every frame (the server only updates a few times a second). When the car leaves it
 * shows the stop's final pit-lane time from the server (Natsoft's PT) for a few seconds.
 */
function PitTimer({ car, serverNow, rate }: { car: CarRow; serverNow: number; rate: number }) {
  const log = car.pitLog ?? []
  const open = car.inPit ? [...log].reverse().find((s) => s.outAt === 0) : undefined
  const last = log[log.length - 1]
  const justOut = !car.inPit && last && last.outAt > 0 && last.seconds > 0 && serverNow - last.outAt < PIT_RESULT_SECONDS
  if (car.inPit) {
    return open && open.inAt > 0
      ? <PitCounter since={open.inAt} serverNow={serverNow} rate={rate} />
      : <span className="pit-badge" title="In the pit lane">PIT</span>
  }
  if (justOut) return <span className="pit-badge done" title="Time in the pit lane (from the timing)">PIT {last.seconds.toFixed(1)}s</span>
  return null
}

/** Separate component so only cars in the pit lane re-render every frame. */
function PitCounter({ since, serverNow, rate }: { since: number; serverNow: number; rate: number }) {
  const now = useSessionClock(serverNow, rate)
  return <span className="pit-badge" title="In the pit lane">PIT {Math.max(0, now - since).toFixed(1)}s</span>
}

/** Small stopwatch for the fastest lap badge; uses the text colour so it suits the badge. */
function StopwatchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <rect x="6" y="0.5" width="4" height="1.8" rx="0.6" fill="currentColor" />
      <circle cx="8" cy="9.3" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9.3V5.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12.6 3.6l1.2-1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** A small chequered flag (2 x 3 squares on a pole) for cars that have finished. */
function ChequerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
      <path d="M2.5 1.5v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.5" y="2" width="11" height="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M3.5 2h3.67v2.5H3.5zM10.83 2h3.67v2.5h-3.67zM7.17 4.5h3.66V7H7.17zM3.5 7h3.67v2.5H3.5zM10.83 7h3.67v2.5h-3.67z" fill="currentColor" />
    </svg>
  )
}

/** "5 seconds" -> "+5s", "plp" (pit lane penalty) -> "PLP", "Drive Through" -> "DT"; anything else -> "PEN". */
function penaltyBadge(penalty: string): string {
  const seconds = penalty.match(/(\d+)\s*sec/i)
  if (seconds) return `+${seconds[1]}s`
  if (/\bplp\b|pit\s*lane/i.test(penalty)) return 'PLP'
  if (/drive\s*through/i.test(penalty)) return 'DT'
  if (/stop\s*(and|&)\s*go/i.test(penalty)) return 'S&G'
  return 'PEN'
}

const abbreviation = (name: string) => surname(name).replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()

/**
 * Laps per driver at co-driver events, e.g. "FEE 71 · WHI 23/60". With a minimum-laps rule, a driver who still
 * needs laps shows the target; red when there aren't enough laps left in the race to get there.
 */
function DriverLaps({ car, minLaps, lapsLeft }: { car: CarRow; minLaps: number; lapsLeft: number }) {
  return (
    <>
      {car.drivers.map((name, i) => {
        const laps = car.driverLaps?.[i] ?? 0
        const needed = minLaps > 0 ? minLaps - laps : 0
        const cls = ['dl', name === car.driver ? 'in-car' : '', minLaps > 0 && needed <= 0 ? 'done' : '', needed > 0 && lapsLeft > 0 && needed > lapsLeft ? 'at-risk' : '']
        const title = `${name}: ${laps} laps${needed > 0 ? `, needs ${needed} more (minimum ${minLaps})` : ''}${name === car.driver ? ' · in the car' : ''}`
        return (
          <span key={name} className={cls.filter(Boolean).join(' ')} title={title}>
            {abbreviation(name)} {laps}{needed > 0 ? `/${minLaps}` : ''}
          </span>
        )
      })}
      {car.unattributedLaps > 0 && (
        <span className="dl unknown" title={`${car.unattributedLaps} laps before we connected: Natsoft hasn't said who drove them yet`}>+{car.unattributedLaps}?</span>
      )}
    </>
  )
}

export function TimingTower({ timing, simple, columnPrefs, hoverId, highlightIds = [], clockRate = 1, pinned, onHover, onTogglePin, onOpen, actions, pitGhost = null, signals }: {
  timing: TimingSnapshot
  simple: boolean
  /** The viewer's detailed-mode layout per session kind (settings panel). */
  columnPrefs: Partial<Record<SessionKind, ColumnPrefs>>
  hoverId: string | null
  /** Cars named by the insight under the mouse. */
  highlightIds?: string[]
  /** Session clock rate (see FeedStatus.clockRate). */
  clockRate?: number
  pinned: string[]
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
  /** Click on a driver's name: open their Focus view. */
  onOpen?: (id: string) => void
  /** Pit rejoin and chart buttons on each row (live races only). */
  actions?: RowActionProps
  /** The pit rejoin estimate: a tag on the car's row and a "would rejoin here" row where it would come out. */
  pitGhost?: PitGhost | null
  /** Race signals (towerSignals.ts), worked out once in SessionView and shared with the race feed. */
  signals: TowerSignals
}) {
  const { best, timingPoints } = timing
  const race = isRace(timing.session.type)
  const order = ['M', ...timingPoints.map((p) => p.id)]
  // Races: order by progress on the road, which updates at every timing point (Natsoft re-orders at the line).
  // Road order while racing; Natsoft's official classification after the chequered flag (raceOrder).
  const finished = race && raceFinished(timing)
  const cars = race ? raceOrder(timing) : timing.cars
  const rowRef = useRowMoves(cars.map((c) => c.id))
  // Driver laps only matter when cars are shared (co-driver events).
  const shared = cars.some((c) => (c.drivers?.length ?? 0) > 1)
  const kind: SessionKind = race ? 'race' : 'timed'
  const phone = useMediaQuery(PHONE)
  const columns = phoneOrder(visibleColumns(kind, simple, columnPrefs[kind]), phone)
    .filter((k) => k !== 'driverLaps' || shared)
    .map((k) => COLUMNS[k])
  const totalLaps = raceLaps(timing.session)
  const leaderLaps = cars[0]?.laps ?? 0
  const lapsLeft = totalLaps > 0 ? Math.max(0, totalLaps - leaderLaps) : 0
  const minLaps = minDriverLaps(timing.session)
  // Row buttons only while racing: no pit stops or charts to add after the flag, or outside races.
  const rowActions = race && !finished ? actions : undefined
  const chequered = finishedCars(timing)


  // Where the "would rejoin here" row goes: before the car that would be just behind it (others only, in race order).
  const rejoin = race && !finished && pitGhost?.status === 'ok' ? pitGhost.rejoin : null
  const others = rejoin ? cars.filter((c) => c.id !== pitGhost!.car.id) : []
  const ghostRowAt = rejoin ? (others[rejoin.position - 1]?.id ?? 'end') : null
  const ghostRow = rejoin && pitGhost && (
    <tr key="pit-ghost" className="ghost-row">
      <td colSpan={columns.length}>
        <span className="pit-ghost-swatch" aria-hidden />
        #{pitGhost.car.carNumber} {pitGhost.car.driver} would rejoin here · <b>P{rejoin.position}</b>
        {rejoin.best !== rejoin.worst && <> (likely P{rejoin.best}–P{rejoin.worst})</>}
        {/* Where that leaves it once everyone has stopped (towerSignals): the number that matters for the race. */}
        {signals.netPosition.has(pitGhost.car.id) && (
          <i className="ghost-row-net" title="Pit-adjusted position (estimate): where this car is if every car had made the same number of stops">
            {' '}· P{signals.netPosition.get(pitGhost.car.id)} pit-adjusted
          </i>
        )}
        <span className="ghost-row-note">estimate</span>
      </td>
    </tr>
  )

  return (
    <div className={`tower-wrap${simple ? ' simple' : ''}`}>
      <table className="tower">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={[`col-${col.key}`, col.numeric ? 'num' : '', col.className?.(race) ?? ''].join(' ')}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cars.map((car, i) => [ghostRowAt === car.id && ghostRow, (() => {
            const ctx: Ctx = { car, order, segmentBest: timing.segmentBest ?? [], now: timing.now, simple, isFirst: i === 0, rank: race && !finished ? i + 1 : car.position, finished, leader: cars[0], ahead: cars[i - 1], race, best, points: timingPoints, session: timing.session, timing, clockRate, minLaps, lapsLeft, onOpen, actions: rowActions, signals, pitGhost, chequered: chequered.has(car.id) }
            const role = signals.battle.get(car.id)
            const classes = [role && `battle-${role}`, car.inPit && 'in-pit', car.id === hoverId && 'hovered', highlightIds.includes(car.id) && 'highlighted', pinned.includes(car.carNumber) && 'pinned']
            return (
              <tr
                key={car.id}
                ref={rowRef(car.id)}
                className={classes.filter(Boolean).join(' ')}
                onMouseEnter={() => onHover(car.id)}
                onMouseLeave={() => onHover(null)}
                onDoubleClick={() => onTogglePin(car.carNumber)}
              >
                {columns.map((col) => {
                  const cls = [`col-${col.key}`, col.numeric ? 'num' : '', col.className?.(race) ?? '', col.cellClass?.(ctx) ?? '', col.flashKey ? 'flash' : '']
                  // Keying on the value re-mounts the cell when a new time arrives, which replays the flash animation.
                  const key = col.flashKey ? `${col.key}-${col.flashKey(ctx)}` : col.key
                  return <td key={key} className={cls.join(' ')}>{col.cell(ctx)}</td>
                })}
              </tr>
            )
          })()])}
          {ghostRowAt === 'end' && ghostRow}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Phones (390 px) only had room for Pos, +/−, Car and Driver: the gap, the number that matters, was off to the side.
 * There, positions gained and driver laps move to just after Gap and Int (the rest scrolls sideways as before).
 */
function phoneOrder(keys: string[], phone: boolean): string[] {
  if (!phone) return keys
  const later: string[] = keys.filter((k) => k === 'posChange' || k === 'driverLaps')
  const rest = keys.filter((k) => !later.includes(k))
  const after = Math.max(rest.indexOf('gap'), rest.indexOf('int'), rest.indexOf('best'))
  return after < 0 ? keys : [...rest.slice(0, after + 1), ...later, ...rest.slice(after + 1)]
}
