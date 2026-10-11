import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LapHistory, TimingSnapshot } from '../types'
import { roadOrder } from '../liveGaps'
import { lapTime } from '../format'
import { SLOTS, gapPoints, lapTimePoints, positionPoints, shortLap, surname } from '../chartData'
import { LineChart, type Domain, type Series } from './LineChart'
import { BattleChart } from './RaceCharts'

export type ChartKind = 'gaps' | 'laps' | 'position' | 'battle'

const KINDS: [ChartKind, string][] = [['gaps', 'Gap to leader'], ['laps', 'Lap times'], ['position', 'Position'], ['battle', 'Battle']]
/** Cars at once in the large view (all eight palette slots). */
const MAX_CARS = SLOTS.length

/** "2:08.5", "128.5" or "+12" -> seconds (or a plain number). Null if empty or unreadable. */
function parseValue(text: string): number | null {
  const t = text.trim().replace(/^\+/, '').replace(/s$/, '')
  if (!t) return null
  const m = t.match(/^(\d+):(\d+(?:\.\d+)?)$/)
  const v = m ? Number(m[1]) * 60 + Number(m[2]) : Number(t)
  return Number.isFinite(v) ? v : null
}

/**
 * Large chart view over the app (blurred behind). Bigger charts with a point on every lap when zoomed in, up to
 * eight cars from the whole field, and control over the axes: scroll to zoom the laps (Shift+scroll for the y
 * axis), drag to pan, double-click to reset, or type the lap range and y range. Escape or a click outside closes it.
 */
export function ChartLab({ timing, history, initialCars, initialKind, onClose }: {
  timing: TimingSnapshot
  history: LapHistory
  initialCars: string[]
  initialKind: ChartKind
  onClose: () => void
}) {
  const [kind, setKind] = useState<ChartKind>(initialKind)
  const [cars, setCars] = useState<string[]>(initialCars.slice(0, MAX_CARS))
  const [xDomain, setXDomain] = useState<Domain | null>(null)
  const [yDomain, setYDomain] = useState<Domain | null>(null)
  const [cleanLaps, setCleanLaps] = useState(true)
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const running = roadOrder(timing.cars, order)
  const [a, setA] = useState(initialCars[0] ?? running[0]?.id ?? '')
  const [b, setB] = useState(initialCars[1] ?? running[1]?.id ?? '')

  // Colour slots follow the car while it's selected.
  const slots = useRef(new Map<string, number>())
  const colorOf = (id: string) => {
    if (!slots.current.has(id)) {
      const used = new Set([...slots.current.entries()].filter(([k]) => cars.includes(k)).map(([, v]) => v))
      slots.current.set(id, [...SLOTS.keys()].find((i) => !used.has(i)) ?? 0)
    }
    return SLOTS[slots.current.get(id)!]
  }
  const toggle = (id: string) => {
    const next = cars.includes(id) ? cars.filter((x) => x !== id) : [...cars, id].slice(-MAX_CARS)
    for (const k of [...slots.current.keys()]) if (!next.includes(k)) slots.current.delete(k)
    setCars(next)
  }
  const label = (id: string) => {
    const live = timing.cars.find((c) => c.id === id)
    return live ? `#${live.carNumber} ${surname(live.driver)}` : id
  }

  // Escape closes; focus moves into the dialog on open and back to where it was on close. Set up once: the parent
  // re-renders with every live update, and re-running this would keep pulling focus out of the axis inputs.
  const close = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); before?.focus?.() }
  }, [])

  // Switching chart type starts with automatic axes.
  const pick = (k: ChartKind) => { setKind(k); setXDomain(null); setYDomain(null) }

  const lapsOf = (id: string) => history.cars.find((c) => c.id === id)
  const build = (points: (c: NonNullable<ReturnType<typeof lapsOf>>) => Series['points']): Series[] =>
    cars.map((id) => lapsOf(id)).filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({ id: c.id, label: label(c.id), color: colorOf(c.id), points: points(c) }))

  const big = { width: 1100, height: 480, xDomain, yDomain, onXDomain: setXDomain, onYDomain: setYDomain, showPoints: true }
  const yFmt = kind === 'laps' ? lapTime : kind === 'position' ? (v: number) => `P${Math.round(v)}` : (v: number) => `+${v.toFixed(1)}s`
  const lastLap = Math.max(0, ...history.cars.flatMap((c) => c.laps.map((l) => l.lap)))
  const [xs, ys] = [xDomain ?? null, yDomain ?? null]

  // Rendered at the end of <body>, so nothing in the map column can affect its fixed positioning.
  return createPortal(
    <div className="chart-lab-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="chart-lab" role="dialog" aria-modal="true" aria-label="Chart view">
        <div className="chart-lab-head">
          <h2>Charts</h2>
          <div className="segmented" role="tablist">
            {KINDS.map(([k, name]) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? 'active' : ''} onClick={() => pick(k)}>{name}</button>
            ))}
          </div>
          <button ref={close} type="button" className="chart-lab-close" onClick={onClose} aria-label="Close the chart view">×</button>
        </div>

        {kind !== 'battle' ? (
          <div className="chart-cars" aria-label="Cars on the chart">
            {running.map((c) => {
              const on = cars.includes(c.id)
              return (
                <button key={c.id} type="button" className={`chart-car${on ? ' on' : ''}`} onClick={() => toggle(c.id)} aria-pressed={on}
                  title={on ? 'Remove from the chart' : `Add to the chart (up to ${MAX_CARS}; adds this, drops the oldest)`}>
                  {on && <span className="chart-swatch" style={{ background: colorOf(c.id) }} />}#{c.carNumber} {surname(c.driver)}
                </button>
              )
            })}
          </div>
        ) : (
          <div className="battle-pick">
            <select value={a} onChange={(e) => setA(e.target.value)} aria-label="First car">{running.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}</select>
            <span>vs</span>
            <select value={b} onChange={(e) => setB(e.target.value)} aria-label="Second car">{running.map((c) => <option key={c.id} value={c.id}>{label(c.id)}</option>)}</select>
          </div>
        )}

        <div className="chart-lab-axes">
          <AxisInputs label="Laps" value={xs} onChange={setXDomain} format={(v) => String(Math.round(v))} placeholder={['1', String(lastLap)]} />
          <AxisInputs label={kind === 'laps' ? 'Lap time' : kind === 'position' ? 'Position' : 'Seconds'} value={ys} onChange={setYDomain}
            format={kind === 'laps' ? shortLap : (v) => (Math.round(v * 10) / 10).toString()} placeholder={['auto', 'auto']} />
          {kind === 'laps' && (
            <label className="chart-lab-check"><input type="checkbox" checked={cleanLaps} onChange={(e) => setCleanLaps(e.target.checked)} /> Hide pit, out and slow laps</label>
          )}
          <button type="button" className="link-button" onClick={() => { setXDomain(null); setYDomain(null) }}>Reset axes</button>
          <span className="chart-lab-hint">Scroll to zoom laps · Shift+scroll zooms the y axis · drag to pan · double-click resets</span>
        </div>

        <div className="chart-lab-plot">
          {kind === 'gaps' && <LineChart series={build(gapPoints)} invertY yFormat={yFmt} ariaLabel="Gap to the leader at the end of each lap" {...big} />}
          {kind === 'laps' && <LineChart series={build((c) => lapTimePoints(c, cleanLaps))} yFormat={yFmt} axisFormat={shortLap} ariaLabel="Lap times" {...big} />}
          {kind === 'position' && <LineChart series={build(positionPoints)} invertY integerY yFormat={yFmt} ariaLabel="Position at the end of each lap" {...big} />}
          {kind === 'battle' && <BattleChart history={history} a={a} b={b} label={label} big={big} />}
        </div>
        {kind !== 'battle' && (
          <p className="chart-note">
            {kind === 'gaps' && 'Gap to the leader at the line each lap; lapped laps left out. Hollow markers: pit stop laps.'}
            {kind === 'laps' && (cleanLaps ? 'Pit laps, out-laps and laps more than 7% off the car’s usual pace are hidden.' : 'Every timed lap, including pit and safety car laps. Hollow markers: pit stop laps.')}
            {kind === 'position' && 'Official position at the line each lap (Natsoft re-orders positions at the line). Hollow markers: pit stop laps.'}
          </p>
        )}
      </div>
    </div>
  , document.body)
}

/** "From / to" inputs for one axis. Empty = automatic. Values are applied when both read correctly. */
function AxisInputs({ label, value, onChange, format, placeholder }: {
  label: string
  value: Domain | null
  onChange: (d: Domain | null) => void
  format: (v: number) => string
  placeholder: [string, string]
}) {
  const [lo, setLo] = useState('')
  const [hi, setHi] = useState('')
  // Show the current range (from zooming) unless the field is being edited.
  const editing = useRef<'lo' | 'hi' | null>(null)
  useEffect(() => {
    if (editing.current !== 'lo') setLo(value && Number.isFinite(value[0]) ? format(value[0]) : '')
    if (editing.current !== 'hi') setHi(value && Number.isFinite(value[1]) ? format(value[1]) : '')
  }, [value, format])
  const apply = (nextLo: string, nextHi: string) => {
    const a = parseValue(nextLo), b = parseValue(nextHi)
    // Empty = automatic. One side typed: that end is fixed, the other stays automatic (NaN).
    if (!nextLo.trim() && !nextHi.trim()) onChange(null)
    else if (a !== null && b !== null && a !== b) onChange(a < b ? [a, b] : [b, a])
    else if (a !== null && !nextHi.trim()) onChange([a, NaN])
    else if (b !== null && !nextLo.trim()) onChange([NaN, b])
  }
  return (
    <span className="axis-inputs">
      <span className="axis-label">{label}</span>
      <input value={lo} placeholder={placeholder[0]} aria-label={`${label} from`} inputMode="decimal"
        onFocus={() => { editing.current = 'lo' }} onBlur={() => { editing.current = null; apply(lo, hi) }}
        onChange={(e) => setLo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(lo, hi) }} />
      <span>to</span>
      <input value={hi} placeholder={placeholder[1]} aria-label={`${label} to`} inputMode="decimal"
        onFocus={() => { editing.current = 'hi' }} onBlur={() => { editing.current = null; apply(lo, hi) }}
        onChange={(e) => setHi(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') apply(lo, hi) }} />
      {value && <button type="button" className="link-button" onClick={() => onChange(null)}>auto</button>}
    </span>
  )
}
