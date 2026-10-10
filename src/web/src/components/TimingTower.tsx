import type { ReactNode } from 'react'
import type { CarRow, TimingSnapshot } from '../types'
import { gapText, lapTime, seconds, timeClass } from '../format'
import { MiniSectors } from './MiniSectors'
import { isRace } from '../session'

interface Ctx {
  car: CarRow
  order: string[]
  segmentBest: number[]
  now: number
  simple: boolean
  isFirst: boolean
  race: boolean
  best: TimingSnapshot['best']
  points: TimingSnapshot['timingPoints']
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

const gapOf = (c: Ctx) => ({ gap: c.car.gap, laps: c.car.gapLaps, int: c.car.interval, intLaps: c.car.intervalLaps })

const COLUMNS: Record<string, Column> = {
  pos: { key: 'pos', header: 'Pos', numeric: true, cell: ({ car }) => car.position || '', cellClass: () => 'pos' },
  car: {
    key: 'car', header: 'Car',
    cell: ({ car }) => <span className={`car mfr-${car.manufacturer.toLowerCase()}`} title={car.vehicle}>{car.carNumber}</span>,
  },
  driver: {
    key: 'driver', header: 'Driver', cellClass: () => 'driver',
    cell: ({ car, now, simple }) => {
      // Co-driver events: name the driver in the car, with the other driver alongside in detailed mode.
      const others = (car.drivers ?? []).filter((d) => d && d !== car.driver)
      const swapped = car.driverChangedAt > 0 && now - car.driverChangedAt < 180
      return (
        <>
          {car.driver}
          {!simple && others.length > 0 && <span className="co-driver"> / {others.map(surname).join(', ')}</span>}
          {swapped && <span className="swap-badge" title="Driver change">SWAP</span>}
          {car.inPit && <span className="pit-badge">PIT</span>}
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
    cell: (c) => { const g = gapOf(c); return gapText(g.gap, g.laps, c.isFirst) },
  },
  int: {
    key: 'int', header: 'Int', numeric: true,
    cell: (c) => {
      const g = gapOf(c)
      if (c.isFirst) return ''
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
  minis: { key: 'minis', header: 'Mini-sectors', cell: ({ car, order, segmentBest }) => <MiniSectors car={car} order={order} sessionBest={segmentBest} /> },
}

/** Which columns to show, in order, for each session kind and display mode. */
const LAYOUTS = {
  timed: {
    detailed: ['pos', 'car', 'driver', 'best', 'gap', 'int', 'last', 's1', 's2', 's3', 'speed', 'pits', 'laps', 'minis'],
    simple: ['pos', 'car', 'driver', 'best', 'gap', 'last', 'pits', 'laps'],
  },
  race: {
    detailed: ['pos', 'car', 'driver', 'gap', 'int', 'last', 'best', 's1', 's2', 's3', 'speed', 'pits', 'laps', 'minis'],
    simple: ['pos', 'car', 'driver', 'gap', 'int', 'last', 'pits', 'laps'],
  },
}

export function TimingTower({ timing, simple, hoverId, pinned, onHover, onTogglePin }: {
  timing: TimingSnapshot
  simple: boolean
  hoverId: string | null
  pinned: string[]
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
}) {
  const { cars, best, timingPoints } = timing
  const race = isRace(timing.session.type)
  const order = ['M', ...timingPoints.map((p) => p.id)]
  const columns = LAYOUTS[race ? 'race' : 'timed'][simple ? 'simple' : 'detailed'].map((k) => COLUMNS[k])

  return (
    <div className={`tower-wrap${simple ? ' simple' : ''}`}>
      <table className="tower">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} className={[col.numeric ? 'num' : '', col.className?.(race) ?? ''].join(' ')}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cars.map((car, i) => {
            const ctx: Ctx = { car, order, segmentBest: timing.segmentBest ?? [], now: timing.now, simple, isFirst: i === 0, race, best, points: timingPoints }
            const classes = [car.inPit && 'in-pit', car.id === hoverId && 'hovered', pinned.includes(car.carNumber) && 'pinned']
            return (
              <tr
                key={car.id}
                className={classes.filter(Boolean).join(' ')}
                onMouseEnter={() => onHover(car.id)}
                onMouseLeave={() => onHover(null)}
                onDoubleClick={() => onTogglePin(car.carNumber)}
              >
                {columns.map((col) => {
                  const cls = [col.numeric ? 'num' : '', col.className?.(race) ?? '', col.cellClass?.(ctx) ?? '', col.flashKey ? 'flash' : '']
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
