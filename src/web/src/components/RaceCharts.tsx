import { useMemo, useRef, useState } from 'react'
import type { CarLaps, LapHistory, TimingSnapshot } from '../types'
import { useLapHistory } from '../useLapHistory'
import { roadOrder } from '../liveGaps'
import { raceLaps } from '../session'
import { lapTime } from '../format'
import { SLOTS, battlePoints, gapPoints, lapTimePoints, linearFit, shortLap, surname, trendLaps } from '../chartData'
import { LineChart, type Series } from './LineChart'
import { ChartLab } from './ChartLab'

/** Cars at once in the small panel (the large view takes up to eight). */
const MAX_CARS = 5

type Tab = 'gaps' | 'laps' | 'battle'

/**
 * Race charts under the map: gap to the leader and lap times per lap for the chosen cars, and a battle graph for
 * two cars with the trend over the last 10 laps. Data comes from GET /api/laps (refreshed every 10 s). "Expand"
 * opens the large chart view (ChartLab) with more cars, zoom and editable axes.
 */
export function RaceCharts({ timing }: { timing: TimingSnapshot }) {
  const history = useLapHistory(timing.session.name)
  const [tab, setTab] = useState<Tab>('gaps')
  const [expanded, setExpanded] = useState(false)
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const running = roadOrder(timing.cars, order)
  // Lap axis runs to the race distance (161 at Bathurst) when it's known, so the charts show how much race is left.
  const xMax = raceLaps(timing.session) || undefined

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
  const gapSeries: Series[] = cars.map((c) => ({ id: c.id, label: label(c.id), color: colorOf(c.id), points: gapPoints(c) }))
  const lapSeries: Series[] = cars.map((c) => ({ id: c.id, label: label(c.id), color: colorOf(c.id), points: lapTimePoints(c) }))

  return (
    <section className="race-charts" aria-label="Race charts">
      <div className="charts-head">
        <h2>Charts</h2>
        <div className="charts-head-right">
          <div className="segmented small" role="tablist">
            {([['gaps', 'Gap to leader'], ['laps', 'Lap times'], ['battle', 'Battle']] as const).map(([k, name]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{name}</button>
            ))}
          </div>
          <button type="button" className="expand-button" onClick={() => setExpanded(true)} title="Open the large chart view: more cars, zoom, editable axes">⤢ Expand</button>
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
            ? <LineChart series={gapSeries} invertY xMax={xMax} yFormat={(v) => `+${v.toFixed(0)}s`} ariaLabel="Gap to the leader at the end of each lap" />
            : <LineChart series={lapSeries} xMax={xMax} yFormat={(v) => lapTime(v)} axisFormat={shortLap} ariaLabel="Lap times (pit, out and slow laps left out)" />}
          <p className="chart-note">
            {tab === 'gaps'
              ? 'Gap to the leader at the line each lap. Hollow markers: pit stop laps. Lapped laps are left out.'
              : 'Pit laps, out-laps and laps more than 7% off the car’s usual pace (safety car, incidents) are left out.'}
          </p>
        </>
      )}
      {tab === 'battle' && <Battle history={history} running={running.map((c) => c.id)} label={label} xMax={xMax} />}
      {expanded && (
        <ChartLab timing={timing} history={history} initialCars={selected} initialKind={tab === 'laps' ? 'laps' : tab}
          onClose={() => setExpanded(false)} />
      )}
    </section>
  )
}

/** Battle graph: gap between two cars per lap, with a trend over the last 10 laps since either car's latest stop. */
function Battle({ history, running, label, xMax }: { history: LapHistory; running: string[]; label: (id: string) => string; xMax?: number }) {
  const [a, setA] = useState(running[0] ?? '')
  const [b, setB] = useState(running[1] ?? '')
  return (
    <div className="battle">
      <div className="battle-pick">
        <select value={a} onChange={(e) => setA(e.target.value)} aria-label="First car">{running.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select>
        <span>vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Second car">{running.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select>
      </div>
      <BattleChart history={history} a={a} b={b} label={label} big={{ xMax }} />
    </div>
  )
}

/** The battle summary, chart and note for cars a and b (shared with the large view). */
export function BattleChart({ history, a, b, label, big }: {
  history: LapHistory; a: string; b: string; label: (id: string) => string
  /** Large-view props passed through to the chart (size, zoom, axes). */
  big?: Partial<Parameters<typeof LineChart>[0]>
}) {
  const ca = history.cars.find((c) => c.id === a)
  const cb = history.cars.find((c) => c.id === b)
  if (!ca || !cb || a === b) return <div className="chart-empty">Pick two cars.</div>
  const points = battlePoints(ca, cb)
  const clean = trendLaps(points)
  const fit = clean.length >= 4 ? linearFit(clean) : null
  const series: Series[] = [{ id: 'gap', label: `${label(b)} to ${label(a)}`, color: SLOTS[0], points }]
  if (fit) {
    series.push({ id: 'trend', label: 'Trend', color: '#8a96a3', dashed: true, decoration: true,
      points: [clean[0].x, clean[clean.length - 1].x].map((x) => ({ x, y: fit.intercept + fit.slope * x })) })
  }
  const last = points[points.length - 1]
  const who = last && last.y >= 0 ? { ahead: label(a), behind: label(b), sign: 1 } : { ahead: label(b), behind: label(a), sign: -1 }
  const rate = fit ? fit.slope * who.sign : 0
  return (
    <>
      {last && (
        <p className="battle-summary">
          {label(b)} is <strong>{Math.abs(last.y).toFixed(1)}s</strong> {last.y >= 0 ? 'behind' : 'ahead of'} {label(a)}.{' '}
          {!fit
            ? 'Not enough laps since the last pit stop for a trend yet.'
            : Math.abs(rate) < 0.05
              ? 'The gap is steady.'
              : rate < 0
                ? <>{who.behind} is gaining <strong>{Math.abs(rate).toFixed(2)}s a lap</strong> (last {clean.length} laps).</>
                : <>{who.ahead} is pulling away by <strong>{rate.toFixed(2)}s a lap</strong> (last {clean.length} laps).</>}
        </p>
      )}
      <LineChart series={series} robustY={!big?.yDomain} yFormat={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}s`}
        ariaLabel={`Gap between ${label(b)} and ${label(a)} per lap`} {...big} />
      <p className="chart-note">Gap at the line each lap; above 0 means {label(b)} is behind. Dashed: trend over the last {clean.length} laps since either car's latest pit stop. Hollow markers: pit laps. Pit-cycle jumps run off the chart.</p>
    </>
  )
}
