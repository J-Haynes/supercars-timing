import type { CarLaps } from './types'
import type { Series } from './components/LineChart'

/**
 * Categorical slots for chart lines, in fixed order: the dark-surface steps of the dataviz reference palette,
 * validated against our panel colour #12161b with the palette script (all checks pass for all eight, adjacent).
 * A car keeps its slot while it's selected (colour follows the car, not its rank).
 */
export const SLOTS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767']

export const surname = (name: string) => name.split(' ').slice(1).join(' ') || name

/** 129.27 -> "2:09.3" for an axis (tooltips show thousandths). */
export const shortLap = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** Gap to the leader at the line per lap; lapped laps left out; pit laps marked. */
export function gapPoints(car: CarLaps): Series['points'] {
  return car.laps.map((l) => ({ x: l.lap, y: l.gapLaps === 0 ? l.gap : null, marked: l.pitted }))
}

/** Official position at the line per lap. */
export function positionPoints(car: CarLaps): Series['points'] {
  return car.laps.map((l) => ({ x: l.lap, y: l.position > 0 ? l.position : null, marked: l.pitted }))
}

/**
 * Lap times. With `clean`, pit laps, out-laps and laps more than 7 % over the car's median (safety car, incidents)
 * are gaps, so the scale stays useful; without it every timed lap is shown (pit laps marked).
 */
export function lapTimePoints(car: CarLaps, clean = true): Series['points'] {
  const ok = (i: number) => {
    const l = car.laps[i]
    return l.time > 0 && !l.pitted && !(i > 0 && car.laps[i - 1].pitted)
  }
  if (!clean) return car.laps.map((l) => ({ x: l.lap, y: l.time > 0 ? l.time : null, marked: l.pitted }))
  const times = car.laps.filter((_, i) => ok(i)).map((l) => l.time).sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)] ?? 0
  return car.laps.map((l, i) => ({ x: l.lap, y: ok(i) && l.time < median * 1.07 ? l.time : null }))
}

/** Gap from car b back to car a at the line per lap (positive = b behind); both on the lead lap; pit laps marked. */
export function battlePoints(a: CarLaps, b: CarLaps): { x: number; y: number; marked: boolean }[] {
  const aLaps = new Map(a.laps.map((l) => [l.lap, l]))
  return b.laps.flatMap((l) => {
    const o = aLaps.get(l.lap)
    if (!o || o.gapLaps !== 0 || l.gapLaps !== 0) return []
    return [{ x: l.lap, y: l.gap - o.gap, marked: l.pitted || o.pitted }]
  })
}

/**
 * Laps for a battle trend: the last (up to) 10 laps since either car's latest pit stop, skipping that out-lap.
 * Across a pit cycle the gap jumps by a minute or more, which made nonsense trends (e.g. "gaining 6.3 s a lap").
 */
export function trendLaps(points: { x: number; y: number; marked: boolean }[]) {
  const lastPit = Math.max(0, ...points.filter((p) => p.marked).map((p) => p.x))
  return points.filter((p) => !p.marked && p.x > lastPit + 1).slice(-10)
}

/** Least-squares line through the points. */
export function linearFit(points: { x: number; y: number }[]) {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const slope = sxx === 0 ? 0 : points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
  return { slope, intercept: my - slope * mx }
}
