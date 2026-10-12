import type { CarRow, TimingSnapshot } from '../types'
import { crossingTime } from '../liveGaps'
import type { LossRange } from './pitLoss'

/**
 * "If they pitted now": where a car would rejoin. EXPERIMENTAL ESTIMATE (see pitLoss.ts for what a stop costs).
 *
 * Every car gets a race progress in seconds: laps x a reference lap, plus the reference time to its last timing
 * point, plus the time since it crossed it (never past the next point it hasn't reached). Two cars' progress differs
 * by their gap on the road: exact for two cars at the same timing point (crossing times), approximate in between.
 * A stop takes `loss` seconds off the car's progress; the other cars keep theirs. That's what F1 timing tools' "pit
 * window" does too (docs/PLANNING.md, "Pit strategy features").
 */

/** Closer than this to the car ahead after rejoining = in its dirty air (an assumption, not a measured figure). */
export const CLEAR_AIR_SECONDS = 2

export interface Neighbour {
  car: CarRow
  /** Seconds on the road (positive either way). */
  gap: number
  /** The car is a lap or more ahead (+) or behind (-) in the race: traffic, not a position. */
  lapsApart: number
}

export interface Rejoin {
  /** Race position at the median loss, and the best/worst over the loss range. */
  position: number
  best: number
  worst: number
  /** Cars around the rejoin point on the road (at the median loss), lapped ones included: the traffic. */
  ahead: Neighbour | null
  behind: Neighbour | null
  clearAir: boolean
  /** The loss range used (seconds). */
  loss: LossRange
}

export interface ProgressModel {
  order: string[]
  /** Reference seconds from each timing point to the next (point order). */
  segments: number[]
  lap: number
  cum: number[]
}

/** The reference pace: the session's segment reference where known, else the track file's (`fallback`). */
export function progressModel(timing: TimingSnapshot, fallback: number[]): ProgressModel | null {
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const segments = order.map((_, i) => timing.segmentReference?.[i] || fallback[i] || 0)
  if (segments.some((s) => s <= 0)) return null
  const cum = [0]
  for (const s of segments) cum.push(cum[cum.length - 1] + s)
  return { order, segments, lap: cum[cum.length - 1], cum }
}

/** A car's race progress in seconds at `now` (see the module comment), or null when it can't be placed. */
export function progress(car: CarRow, m: ProgressModel, now: number, lossOf: (car: CarRow) => number): number | null {
  if (car.retired) return null
  const i = m.order.indexOf(car.lastPoint)
  if (i < 0) return null
  const crossed = crossingTime(car, m.order, car.lastPoint, car.laps + 1) ?? (car.lastPointAt || null)
  const at = car.laps * m.lap + m.cum[i]
  if (crossed === null) return at
  if (car.inPit) {
    // In the pit lane: where it was at pit entry, moving on at racing pace, minus what the stop costs.
    const stop = car.pitLog.at(-1)
    const inAt = stop && stop.outAt === 0 ? stop.inAt : now
    return at + clamp(inAt - crossed, 0, m.segments[i]) + Math.max(0, now - inAt) - lossOf(car)
  }
  return at + clamp(now - crossed, 0, m.segments[i])
}

/** Where `car` would rejoin if it pitted now, for the loss range `loss`. Null when it can't be worked out. */
export function predictRejoin(timing: TimingSnapshot, car: CarRow, loss: LossRange, m: ProgressModel, now: number,
  lossOf: (car: CarRow) => number): Rejoin | null {
  if (car.inPit || car.retired) return null
  const mine = progress(car, m, now, lossOf)
  if (mine === null) return null
  const others = timing.cars
    .filter((c) => c.id !== car.id)
    .map((c) => ({ car: c, p: progress(c, m, now, lossOf) }))
    .filter((o): o is { car: CarRow; p: number } => o.p !== null)
  const positionAt = (lost: number) => 1 + others.filter((o) => o.p > mine - lost).length
  const ghost = mine - loss[1]
  // Road neighbours: the gap on the road wraps every lap (a lapped car can be right ahead).
  let ahead: Neighbour | null = null
  let behind: Neighbour | null = null
  for (const o of others) {
    const diff = o.p - ghost
    const road = ((diff % m.lap) + m.lap * 1.5) % m.lap - m.lap / 2 // in (-lap/2, lap/2]
    const lapsApart = Math.round((diff - road) / m.lap)
    if (road > 0 && (!ahead || road < ahead.gap)) ahead = { car: o.car, gap: road, lapsApart }
    if (road <= 0 && (!behind || -road < behind.gap)) behind = { car: o.car, gap: -road, lapsApart }
  }
  return {
    position: positionAt(loss[1]),
    best: positionAt(loss[0]),
    worst: positionAt(loss[2]),
    ahead,
    behind,
    clearAir: !ahead || ahead.gap >= CLEAR_AIR_SECONDS,
    loss,
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}
