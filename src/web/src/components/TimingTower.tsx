import type { ReactNode } from 'react'
import type { CarRow, TimingSnapshot } from '../types'
import { gapText, lapTime, seconds, timeClass } from '../format'
import { MiniSectors } from './MiniSectors'
import { isRace, minDriverLaps, raceLaps } from '../session'
import { visibleColumns, type ColumnPrefs, type SessionKind } from '../towerLayout'
import { startPosition } from '../startingGrid'
import { carPenalties } from '../penalties'
import { liveGap, parkedAtLine, roadOrder } from '../liveGaps'
import { useRowMoves } from './useRowMoves'
import { useSessionClock } from '../map/useSessionClock'

interface Ctx {
  car: CarRow
  order: string[]
  segmentBest: number[]
  now: number
  simple: boolean
  isFirst: boolean
  /** Position shown: road order in races (see roadOrder), Natsoft's otherwise. */
  rank: number
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
  if (!c.race) return { gap: car.gap, laps: car.gapLaps, int: car.interval, intLaps: car.intervalLaps, status: '' }
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
      const start = startPosition(session, car.carNumber)
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
    cell: ({ car }) => <span className={`car mfr-${car.manufacturer.toLowerCase()}`} title={car.vehicle}>{car.carNumber}</span>,
  },
  driver: {
    key: 'driver', header: 'Driver', cellClass: () => 'driver',
    cell: ({ car, now, simple, race, best, timing, clockRate }) => {
      // Co-driver events: name the driver in the car, with the other driver alongside in detailed mode.
      const others = (car.drivers ?? []).filter((d) => d && d !== car.driver)
      const swapped = car.driverChangedAt > 0 && now - car.driverChangedAt < 180
      return (
        <>
          <DriverMarker car={car} />
          {car.driver}
          {!simple && others.length > 0 && <span className="co-driver"> / {others.map(surname).join(', ')}</span>}
          {swapped && <span className="swap-badge" title="Driver change">SWAP</span>}
          {/* Races only: in practice and qualifying the fastest lap is simply P1. */}
          {race && best.lap && Math.abs(car.bestLap - best.lap) < 0.0005 && (
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

export function TimingTower({ timing, simple, columnPrefs, hoverId, highlightIds = [], clockRate = 1, pinned, onHover, onTogglePin }: {
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
}) {
  const { best, timingPoints } = timing
  const race = isRace(timing.session.type)
  const order = ['M', ...timingPoints.map((p) => p.id)]
  // Races: order by progress on the road, which updates at every timing point (Natsoft re-orders at the line).
  const cars = race ? roadOrder(timing.cars, order) : timing.cars
  const rowRef = useRowMoves(cars.map((c) => c.id))
  // Driver laps only matter when cars are shared (co-driver events).
  const shared = cars.some((c) => (c.drivers?.length ?? 0) > 1)
  const kind: SessionKind = race ? 'race' : 'timed'
  const columns = visibleColumns(kind, simple, columnPrefs[kind])
    .filter((k) => k !== 'driverLaps' || shared)
    .map((k) => COLUMNS[k])
  const totalLaps = raceLaps(timing.session)
  const leaderLaps = cars[0]?.laps ?? 0
  const lapsLeft = totalLaps > 0 ? Math.max(0, totalLaps - leaderLaps) : 0
  const minLaps = minDriverLaps(timing.session)

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
          {cars.map((car, i) => {
            const ctx: Ctx = { car, order, segmentBest: timing.segmentBest ?? [], now: timing.now, simple, isFirst: i === 0, rank: race ? i + 1 : car.position, leader: cars[0], ahead: cars[i - 1], race, best, points: timingPoints, session: timing.session, timing, clockRate, minLaps, lapsLeft }
            const classes = [car.inPit && 'in-pit', car.id === hoverId && 'hovered', highlightIds.includes(car.id) && 'highlighted', pinned.includes(car.carNumber) && 'pinned']
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
          })}
        </tbody>
      </table>
    </div>
  )
}
