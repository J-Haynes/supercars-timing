import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { CarLaps, CarRow, LapHistory, TimingSnapshot } from '../types'
import { useLapHistory } from '../useLapHistory'
import { raceOrder } from '../liveGaps'
import { isRace, raceLaps } from '../session'
import { gapText, lapTime, seconds, timeClass } from '../format'
import { SLOTS, battlePoints, lapTimePoints, linearFit, shortLap, surname, trendLaps } from '../chartData'
import { median, recentPace, stints } from '../driverStats'
import { LineChart, type Series } from './LineChart'

export type DriverTab = 'focus' | 'compare'

/**
 * One car in detail (Focus) or two side by side (Compare), opened from a driver's name in the tower. Everything
 * shown is measured (timing and lap history); nothing is estimated. Lap history is the live GET /api/laps unless
 * a page passes its own (replay).
 */
export function DriverDialog({ timing, history: given, carId, compareId, tab, onChange, onClose }: {
  timing: TimingSnapshot
  history?: LapHistory | null
  carId: string
  compareId: string | null
  tab: DriverTab
  onChange: (carId: string, compareId: string | null, tab: DriverTab) => void
  onClose: () => void
}) {
  const live = useLapHistory(timing.session.name, { enabled: given === undefined })
  const history = given === undefined ? live : given
  const order = isRace(timing.session.type) ? raceOrder(timing) : [...timing.cars].sort((a, b) => (a.position || 99) - (b.position || 99))
  const car = timing.cars.find((c) => c.id === carId)
  // Compare with the car ahead by default (the car behind for the leader).
  const index = order.findIndex((c) => c.id === carId)
  const other = timing.cars.find((c) => c.id === compareId) ?? order[index > 0 ? index - 1 : 1]
  const lapsOf = (id?: string) => history?.cars.find((c) => c.id === id)

  // Escape closes; focus moves into the dialog and back on close (same as ChartLab). Set up once: the parent
  // re-renders with every live update.
  const close = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    const body = document.body
    const saved = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      body.style.overflow = saved
      before?.focus?.()
    }
  }, [])

  const pick = (label: string, value: string, onPick: (id: string) => void, exclude?: string) => (
    <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={label}>
      {order.filter((c) => c.id !== exclude).map((c) => (
        <option key={c.id} value={c.id}>P{c.position} #{c.carNumber} {c.driver}</option>
      ))}
    </select>
  )

  return createPortal(
    <div className="chart-lab-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="chart-lab driver-dialog" role="dialog" aria-modal="true" aria-label={tab === 'focus' ? 'Driver focus' : 'Compare two cars'}>
        <div className="chart-lab-head">
          <div className="segmented small" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'focus'} className={tab === 'focus' ? 'active' : ''}
              onClick={() => onChange(carId, compareId, 'focus')}>Focus</button>
            <button type="button" role="tab" aria-selected={tab === 'compare'} className={tab === 'compare' ? 'active' : ''}
              onClick={() => onChange(carId, other?.id ?? null, 'compare')}>Compare</button>
          </div>
          {pick(tab === 'focus' ? 'Driver' : 'First car', carId, (id) => onChange(id, compareId === id ? null : compareId, tab))}
          {tab === 'compare' && <span className="driver-vs">vs</span>}
          {tab === 'compare' && other && pick('Second car', other.id, (id) => onChange(carId, id, tab), carId)}
          <button ref={close} type="button" className="chart-lab-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {!car ? <p className="menu-muted">This car isn't in the session any more.</p>
          : tab === 'focus' ? <Focus timing={timing} car={car} laps={lapsOf(car.id)} historyLoaded={!!history} />
          : other ? <Compare timing={timing} a={car} b={other} aLaps={lapsOf(car.id)} bLaps={lapsOf(other.id)} />
          : <p className="menu-muted">Pick a second car.</p>}
      </div>
    </div>,
    document.body,
  )
}

function Focus({ timing, car, laps, historyLoaded }: { timing: TimingSnapshot; car: CarRow; laps?: CarLaps; historyLoaded: boolean }) {
  const { best } = timing
  const race = isRace(timing.session.type)
  const list = laps ? stints(laps) : []
  const others = car.drivers.filter((d) => d && d !== car.driver)
  const xMax = raceLaps(timing.session) || undefined
  return (
    <div className="driver-focus">
      <div className="driver-title">
        <span className={`driver-swatch mfr-${car.manufacturer.toLowerCase()}`} style={car.teamColour ? { background: `#${car.teamColour}` } : undefined} />
        <h2>P{car.position} · #{car.carNumber} {car.driver}</h2>
        <span className="driver-sub">
          {others.length > 0 && <>with {others.join(', ')} · </>}{car.vehicle}
          {car.inPit ? ' · in the pits' : ''}
        </span>
      </div>

      <div className="stat-row">
        <Stat label="Last lap" value={lapTime(car.lastLap) || '–'} className={timeClass(car.lastLap, car.bestLap, best.lap)} />
        <Stat label="Best lap" value={lapTime(car.bestLap) || '–'} note={car.bestLapNo ? `lap ${car.bestLapNo}` : undefined} className={timeClass(car.bestLap, car.bestLap, best.lap)} />
        {laps && race && <Stat label="Recent pace" value={lapTime(recentPace(laps)) || '–'} note="median, last 5 clean laps" />}
        <Stat label={race ? 'Gap to leader' : 'Gap to P1'} value={gapText(car.gap, car.gapLaps, car.position === 1) || '–'} />
        {race && <Stat label="Laps" value={String(car.laps)} note={`${car.stintLaps} this stint`} />}
        <Stat label="Pit stops" value={String(car.pitStops)} />
        {car.speed > 0 && <Stat label="Speed trap" value={`${Math.round(car.speed)}`} note={best.speed ? `km/h · best ${Math.round(best.speed)}` : 'km/h'} />}
      </div>

      <h3>Sectors</h3>
      <table className="driver-table">
        <thead><tr><th /><th className="num">S1</th><th className="num">S2</th><th className="num">S3</th></tr></thead>
        <tbody>
          <tr><th>Latest</th>{[car.s1, car.s2, car.s3].map((s, i) => <td key={i} className={`num ${timeClass(s, [car.bestS1, car.bestS2, car.bestS3][i], [best.s1, best.s2, best.s3][i])}`}>{seconds(s) || '–'}</td>)}</tr>
          <tr><th>Best</th>{[car.bestS1, car.bestS2, car.bestS3].map((s, i) => <td key={i} className={`num ${timeClass(s, s, [best.s1, best.s2, best.s3][i])}`}>{seconds(s) || '–'}</td>)}</tr>
          <tr><th>Session best</th>{[best.s1, best.s2, best.s3].map((s, i) => <td key={i} className="num muted">{seconds(s) || '–'}</td>)}</tr>
          <tr><th>Best possible</th><td colSpan={3} className="num">{car.bestS1 && car.bestS2 && car.bestS3 ? `${lapTime(car.bestS1 + car.bestS2 + car.bestS3)} (best sectors added up)` : '–'}</td></tr>
        </tbody>
      </table>

      {laps && laps.laps.length >= 2 ? (
        <>
          <h3>Lap times</h3>
          <LineChart ariaLabel={`Lap times for #${car.carNumber}`} yFormat={lapTime} axisFormat={shortLap} xMax={xMax}
            series={[{ id: car.id, label: `#${car.carNumber}`, color: SLOTS[0], points: lapTimePoints(laps) }]} width={760} height={220} />
          <p className="chart-note">Pit laps, out-laps and slow laps (safety car, incidents) are left out.</p>
        </>
      ) : <p className="menu-muted">{historyLoaded ? 'Lap times appear once a few laps have been recorded.' : 'Loading lap history…'}</p>}

      {list.length > 0 && (
        <>
          <h3>Stints</h3>
          <table className="driver-table">
            <thead><tr><th>#</th><th>Laps</th><th>Driver</th><th className="num">Best</th><th className="num" title="Median of the stint's clean laps">Typical</th></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.number}>
                  <td>{s.number}</td>
                  <td>{s.fromLap}–{s.toLap} <span className="muted">({s.laps}{s.pitted ? ', pitted' : ''})</span></td>
                  <td>{s.driver}</td>
                  <td className="num">{lapTime(s.best) || '–'}</td>
                  <td className="num">{lapTime(s.typical) || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {car.pitLog.length > 0 && (
        <>
          <h3>Pit stops</h3>
          <table className="driver-table">
            <thead><tr><th>Lap</th><th className="num">Pit lane</th><th>Driver</th></tr></thead>
            <tbody>
              {car.pitLog.map((p, i) => (
                <tr key={i}>
                  <td>{p.lap}</td>
                  <td className="num">{p.seconds > 0 ? `${p.seconds.toFixed(1)} s` : p.outAt ? '–' : 'in the pits'}</td>
                  <td>{p.driverIn && p.driverOut && p.driverIn !== p.driverOut ? `${surname(p.driverIn)} → ${surname(p.driverOut)}` : surname(p.driverOut || p.driverIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {car.drivers.length > 1 && (
        <>
          <h3>Driver laps</h3>
          <div className="stat-row">
            {car.drivers.map((d, i) => <Stat key={d} label={d} value={String(car.driverLaps[i] ?? 0)} note="laps" />)}
          </div>
        </>
      )}
    </div>
  )
}

function Compare({ timing, a, b, aLaps, bLaps }: { timing: TimingSnapshot; a: CarRow; b: CarRow; aLaps?: CarLaps; bLaps?: CarLaps }) {
  const race = isRace(timing.session.type)
  const xMax = raceLaps(timing.session) || undefined
  const name = (c: CarRow) => `#${c.carNumber} ${surname(c.driver)}`
  const colours = [SLOTS[0], SLOTS[1]]

  // Gap at the line per lap (positive = b behind a) and its trend over the last laps since either car pitted.
  const gaps = race && aLaps && bLaps ? battlePoints(aLaps, bLaps) : []
  const trend = trendLaps(gaps)
  const fit = trend.length >= 3 ? linearFit(trend) : null
  const now = gaps.at(-1)
  let summary: ReactNode = null
  if (now) {
    const behind = now.y > 0 ? b : a
    const ahead = now.y > 0 ? a : b
    summary = <>{name(behind)} is <b>{Math.abs(now.y).toFixed(1)} s</b> behind {name(ahead)} at the line (lap {now.x}).</>
    if (fit) {
      const first = fit.intercept + fit.slope * trend[0].x
      const last = fit.intercept + fit.slope * trend[trend.length - 1].x
      const change = Math.abs(last) - Math.abs(first)
      const perLap = Math.abs(change) / Math.max(1, trend.length - 1)
      summary = <>{summary} Over the last {trend.length} laps the gap has {change < 0 ? 'closed' : 'grown'} by about{' '}
        <b>{Math.abs(change).toFixed(1)} s</b> ({perLap.toFixed(2)} s a lap).</>
    }
  }

  const gapSeries: Series[] = [{ id: 'gap', label: `${name(b)} to ${name(a)}`, color: SLOTS[2], points: gaps.map((p) => ({ x: p.x, y: p.y, marked: p.marked })) }]
  const lapSeries: Series[] = [[a, aLaps], [b, bLaps]].flatMap(([c, l], i) => (l ? [{ id: (c as CarRow).id, label: name(c as CarRow), color: colours[i], points: lapTimePoints(l as CarLaps) }] : []))

  type Row = [label: string, av: number, bv: number, format: (v: number) => string, better: 'low' | 'high' | 'none']
  const pace = (l?: CarLaps) => (l ? recentPace(l) : 0)
  const typical = (l?: CarLaps) => (l ? median(lapTimePoints(l).filter((p) => p.y !== null).map((p) => p.y as number)) : 0)
  const rows: Row[] = [
    ['Position', a.position, b.position, (v) => (v ? `P${v}` : '–'), 'low'],
    ['Last lap', a.lastLap, b.lastLap, lapTime, 'low'],
    ['Best lap', a.bestLap, b.bestLap, lapTime, 'low'],
    ...(race ? [
      ['Recent pace (last 5 clean)', pace(aLaps), pace(bLaps), lapTime, 'low'] as Row,
      ['Typical lap (whole race)', typical(aLaps), typical(bLaps), lapTime, 'low'] as Row,
    ] : []),
    ['Best S1', a.bestS1, b.bestS1, seconds, 'low'],
    ['Best S2', a.bestS2, b.bestS2, seconds, 'low'],
    ['Best S3', a.bestS3, b.bestS3, seconds, 'low'],
    ['Speed trap', a.speed, b.speed, (v) => (v ? `${Math.round(v)} km/h` : ''), 'high'],
    ['Pit stops', a.pitStops, b.pitStops, String, 'none'],
    ...(race ? [['Stint laps', a.stintLaps, b.stintLaps, String, 'none'] as Row] : []),
  ]
  const betterOf = (av: number, bv: number, better: Row[4]) => {
    if (better === 'none' || !av || !bv || av === bv) return null
    return (better === 'low') === (av < bv) ? 'a' : 'b'
  }

  return (
    <div className="driver-compare">
      {summary && <p className="compare-summary">{summary}</p>}
      <table className="driver-table compare-table">
        <thead><tr><th /><th className="num" style={{ color: colours[0] }}>{name(a)}</th><th className="num" style={{ color: colours[1] }}>{name(b)}</th></tr></thead>
        <tbody>
          {rows.map(([label, av, bv, format, better]) => {
            const win = betterOf(av, bv, better)
            return (
              <tr key={label}>
                <th>{label}</th>
                <td className={`num${win === 'a' ? ' better' : ''}`}>{format(av) || '–'}</td>
                <td className={`num${win === 'b' ? ' better' : ''}`}>{format(bv) || '–'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {gaps.length >= 2 && (
        <>
          <h3>Gap between them</h3>
          <LineChart ariaLabel="Gap between the two cars per lap" series={gapSeries} yFormat={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} s`}
            robustY xMax={xMax} width={760} height={200} />
          <p className="chart-note">Above zero: {name(b)} behind. At the control line each lap, both on the lead lap; pit laps marked.</p>
        </>
      )}
      {lapSeries.length > 0 && lapSeries.some((s) => s.points.length >= 2) && (
        <>
          <h3>Lap times</h3>
          <LineChart ariaLabel="Lap times of both cars" series={lapSeries} yFormat={lapTime} axisFormat={shortLap} xMax={xMax} width={760} height={220} />
        </>
      )}
    </div>
  )
}

function Stat({ label, value, note, className = '' }: { label: string; value: string; note?: string; className?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${className}`}>{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}
