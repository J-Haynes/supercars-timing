import type { CarLaps } from './types'
import { lapTimePoints } from './chartData'

/** One stint: the laps between leaving the pits (or the start) and the next stop. */
export interface Stint {
  /** 1-based. */
  number: number
  fromLap: number
  /** Last lap of the stint (the in-lap when it ended in a stop). */
  toLap: number
  laps: number
  /** Who drove most of its laps. */
  driver: string
  /** Fastest lap in the stint (any timed lap). 0 = none. */
  best: number
  /** Median of the stint's clean laps (no pit laps, out-laps or laps 7 % over the car's median). 0 = none. */
  typical: number
  /** Ended with a pit stop (false for the stint still running, or the last one of a finished race). */
  pitted: boolean
}

/**
 * Splits a car's laps into stints at each pit stop. A lap with `pitted` set is the lap the car came in on, so it
 * ends its stint and the next lap (the out-lap) starts the next one.
 */
export function stints(car: CarLaps): Stint[] {
  const clean = new Map(lapTimePoints(car).filter((p) => p.y !== null).map((p) => [p.x, p.y as number]))
  const result: Stint[] = []
  let start = 0
  for (let i = 0; i < car.laps.length; i++) {
    const last = i === car.laps.length - 1
    if (!car.laps[i].pitted && !last) continue
    const laps = car.laps.slice(start, i + 1)
    const counts = new Map<string, number>()
    for (const l of laps) if (l.driver) counts.set(l.driver, (counts.get(l.driver) ?? 0) + 1)
    const timed = laps.map((l) => l.time).filter((t) => t > 0)
    result.push({
      number: result.length + 1,
      fromLap: laps[0].lap,
      toLap: laps[laps.length - 1].lap,
      laps: laps.length,
      driver: driverName(car, [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''),
      best: timed.length ? Math.min(...timed) : 0,
      typical: median(laps.map((l) => clean.get(l.lap)).filter((t): t is number => t !== undefined)),
      pitted: car.laps[i].pitted,
    })
    start = i + 1
  }
  return result
}

/** LapEntry.driver is Natsoft's driver index ("1" = primary, "2" = co-driver): the name from `drivers`. */
export function driverName(car: CarLaps, index: string): string {
  return car.drivers[Number(index) - 1] || car.driver
}

/** Median of the car's last `count` clean laps (see lapTimePoints). 0 = none. */
export function recentPace(car: CarLaps, count = 5): number {
  const clean = lapTimePoints(car).filter((p) => p.y !== null).map((p) => p.y as number)
  return median(clean.slice(-count))
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
