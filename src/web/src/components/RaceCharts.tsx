import { useMemo, useRef, useState } from 'react'
import type { CarLaps, TimingSnapshot } from '../types'
import { useLapHistory } from '../useLapHistory'
import { roadOrder } from '../liveGaps'
import { lapTime } from '../format'
import { LineChart, type Series } from './LineChart'

/**
 * Categorical slots for chart lines, in fixed order (dark-surface steps of the reference palette; validated against
 * our panel colour #12161b: all checks pass for five adjacent series). A car keeps its slot while selected.
 */
const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']
const MAX_CARS = SLOTS.length

type Tab = 'gaps' | 'laps' | 'battle'
const surname = (name: string) => name.split(' ').slice(1).join(' ') || name

/**
 * Race charts under the map: gap to the leader and lap times per lap for the chosen cars, and a battle graph for
 * two cars with the trend over the last 10 laps. Data comes from GET /api/laps (refreshed every 10 s).
 */
export function RaceCharts({ timing }: { timing: TimingSnapshot }) {
  const history = useLapHistory(timing.session.name)
  const [tab, setTab] = useState<Tab>('gaps')
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const running = roadOrder(timing.cars, order)

  // Selected cars and their colour slots. Starts with the top four on the road; colour follows the car, not its rank.
  const slots = useRef(new Map<string, number>())
  const [picked, setPicked] = useState<string[] | null>(null)
  const selected = picked ?? running.slice(0, 4).map((c) => c.id)
  const colorOf = (id: string) => {
    if (!slots.current.has(id)) {
      const used = new Set([...slots.current.entries()].filter(([k]) => selected.includes(k)).map(([, v]) => v))
      slots.current.set(id, [...SLOTS.keys()].find((i) => !used.has(i)) ?? 0)
    }
    return SLOTS[slots.current.get(id)!]
  }
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-MAX_CARS)
    for (const k of [...slots.current.keys()]) if (!next.includes(k)) slots.current.delete(k)
    setPicked(next)
  }

  const byId = useMemo(() => new Map((history?.cars ?? []).map((c) => [c.id, c])), [history])
  const label = (id: string) => {
    const live = timing.cars.find((c) => c.id === id)
    return live ? `#${live.carNumber} ${surname(live.driver)}` : id
  }
  // Nothing to chart yet (or a server without /api/laps): only the phone layout shows this note, on its Charts tab.
  if (!history || history.cars.every((c) => c.laps.length < 2)) {
    return <section className="race-charts empty">Charts appear once a few laps have been recorded.</section>
  }

  const cars = selected.map((id) => byId.get(id)).filter((c): c is CarLaps => !!c)
  const gapSeries: Series[] = cars.map((c) => ({
    id: c.id, label: label(c.id), color: colorOf(c.id),
    points: c.laps.map((l) => ({ x: l.lap, y: l.gapLaps === 0 ? l.gap : null, marked: l.pitted })),
  }))
  const lapSeries: Series[] = cars.map((c) => ({ id: c.id, label: label(c.id), color: colorOf(c.id), points: cleanLapTimes(c) }))

  return (
    <section className="race-charts" aria-label="Race charts">
      <div className="charts-head">
        <h2>Charts</h2>
        <div className="segmented small" role="tablist">
          {([['gaps', 'Gap to leader'], ['laps', 'Lap times'], ['battle', 'Battle']] as const).map(([k, name]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{name}</button>
          ))}
        </div>
      </div>
      {tab !== 'battle' && (
        <>
          <div className="chart-cars" aria-label="Cars on the chart">
            {running.slice(0, 14).map((c) => {
              const on = selected.includes(c.id)
              return (
                <button key={c.id} type="button" className={`chart-car${on ? ' on' : ''}`} onClick={() => toggle(c.id)} aria-pressed={on}
                  title={on ? 'Remove from the chart' : selected.length >= MAX_CARS ? `Up to ${MAX_CARS} cars: adds this, drops the oldest` : 'Add to the chart'}>
                  {on && <span className="chart-swatch" style={{ background: colorOf(c.id) }} />}#{c.carNumber}
                </button>
              )
            })}
          </div>
          {tab === 'gaps'
            ? <LineChart series={gapSeries} invertY yFormat={(v) => `+${v.toFixed(0)}s`} ariaLabel="Gap to the leader at the end of each lap" />
            : <LineChart series={lapSeries} yFormat={(v) => lapTime(v)} axisFormat={shortLap} ariaLabel="Lap times (pit, out and slow laps left out)" />}
          <p className="chart-note">
            {tab === 'gaps'
              ? 'Gap to the leader at the line each lap. Hollow markers: pit stop laps. Lapped laps are left out.'
              : 'Pit laps, out-laps and laps more than 7% off the car’s usual pace (safety car, incidents) are left out.'}
          </p>
        </>
      )}
      {tab === 'battle' && <Battle history={history} running={running.map((c) => c.id)} label={label} />}
    </section>
  )
}

/** 129.27 -> "2:09.3" for the axis (the tooltip shows thousandths). */
const shortLap = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** Lap times with pit laps, out-laps and slow laps (> 7 % over the car's median) as gaps. */
function cleanLapTimes(car: CarLaps): Series['points'] {
  const ok = (i: number) => {
    const l = car.laps[i]
    return l.time > 0 && !l.pitted && !(i > 0 && car.laps[i - 1].pitted)
  }
  const times = car.laps.filter((_, i) => ok(i)).map((l) => l.time).sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)] ?? 0
  return car.laps.map((l, i) => ({ x: l.lap, y: ok(i) && l.time < median * 1.07 ? l.time : null }))
}

/** Battle graph: gap between two cars per lap, with a trend over the last 10 clean laps. */
function Battle({ history, running, label }: { history: { cars: CarLaps[] }; running: string[]; label: (id: string) => string }) {
  const [a, setA] = useState(running[0] ?? '')
  const [b, setB] = useState(running[1] ?? '')
  const ca = history.cars.find((c) => c.id === a)
  const cb = history.cars.find((c) => c.id === b)
  const options = running.map((id) => <option key={id} value={id}>{label(id)}</option>)

  let body = <div className="chart-empty">Pick two cars.</div>
  if (ca && cb && a !== b) {
    const aLaps = new Map(ca.laps.map((l) => [l.lap, l]))
    // Positive = b behind a. Only laps where both are on the lead lap; pit laps for either car are marked.
    const points = cb.laps.flatMap((l) => {
      const o = aLaps.get(l.lap)
      if (!o || o.gapLaps !== 0 || l.gapLaps !== 0) return []
      return [{ x: l.lap, y: l.gap - o.gap, marked: l.pitted || o.pitted }]
    })
    // Trend: only laps since the latest pit stop by either car, skipping that out-lap. Across a pit cycle the gap
    // jumps by a minute or more, which made a nonsense trend (e.g. "gaining 6.3 s a lap").
    const lastPit = Math.max(0, ...points.filter((p) => p.marked).map((p) => p.x))
    const clean = points.filter((p) => !p.marked && p.x > lastPit + 1).slice(-10)
    const fit = clean.length >= 4 ? linearFit(clean) : null
    const series: Series[] = [{ id: 'gap', label: `${label(b)} to ${label(a)}`, color: SLOTS[0], points }]
    if (fit) {
      series.push({ id: 'trend', label: 'Trend', color: '#8a96a3', dashed: true, decoration: true,
        points: [clean[0].x, clean[clean.length - 1].x].map((x) => ({ x, y: fit.intercept + fit.slope * x })) })
    }
    const last = points[points.length - 1]
    const who = last && last.y >= 0 ? { ahead: label(a), behind: label(b), sign: 1 } : { ahead: label(b), behind: label(a), sign: -1 }
    const rate = fit ? fit.slope * who.sign : 0
    body = (
      <>
        {last && !fit && (
          <p className="battle-summary">
            {label(b)} is <strong>{Math.abs(last.y).toFixed(1)}s</strong> {last.y >= 0 ? 'behind' : 'ahead of'} {label(a)}.
            {' '}Not enough laps since the last pit stop for a trend yet.
          </p>
        )}
        {last && fit && (
          <p className="battle-summary">
            {label(b)} is <strong>{Math.abs(last.y).toFixed(1)}s</strong> {last.y >= 0 ? 'behind' : 'ahead of'} {label(a)}.{' '}
            {Math.abs(rate) < 0.05
              ? 'The gap is steady.'
              : rate < 0
                ? <>{who.behind} is gaining <strong>{Math.abs(rate).toFixed(2)}s a lap</strong> (last {clean.length} laps).</>
                : <>{who.ahead} is pulling away by <strong>{rate.toFixed(2)}s a lap</strong> (last {clean.length} laps).</>}
          </p>
        )}
        <LineChart series={series} robustY yFormat={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}s`} ariaLabel={`Gap between ${label(b)} and ${label(a)} per lap`} />
        <p className="chart-note">Gap at the line each lap; above 0 means {label(b)} is behind. Dashed: trend over the last {clean.length} laps since either car's latest pit stop. Hollow markers: pit laps. Pit-cycle jumps run off the chart.</p>
      </>
    )
  }
  return (
    <div className="battle">
      <div className="battle-pick">
        <select value={a} onChange={(e) => setA(e.target.value)} aria-label="First car">{options}</select>
        <span>vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Second car">{options}</select>
      </div>
      {body}
    </div>
  )
}

/** Least-squares line through the points. */
function linearFit(points: { x: number; y: number }[]) {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const slope = sxx === 0 ? 0 : points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
  return { slope, intercept: my - slope * mx }
}
