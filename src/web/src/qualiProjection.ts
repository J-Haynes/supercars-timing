import type { CarRow, TimingSnapshot } from './types'

/**
 * Projected lap times for cars on a lap in practice and qualifying: where the lap would end if the car kept going as
 * it has. Step 1 of the qualifying projection design (docs/PLANNING.md, "Qualifying: projected laps"); the tower and
 * the "On a lap" panel will show these. Tuned with tools/QualiProjection/backtest.mts on recorded sessions.
 *
 * Splits (`currentSplits`, `bestLapSplits`) are seconds from the line to each timing point, in point order, with the
 * lap time last. Stretch times (`bestSegments`) are indexed the same way: stretch k ends at split k. Both series.
 */

/** Where the rest of the lap comes from, best first. */
export type ProjectionBasis =
  /** The rest of the car's own best lap: the gap to its best at the last point, carried to the line. */
  | 'best-lap'
  /** The car's best time through each remaining stretch (its best lap was set before we connected: no splits). */
  | 'best-stretches'
  /** The field's median best through each remaining stretch (no flying lap of its own yet): rough. */
  | 'field'

export interface LapProjection {
  carId: string
  /** Index of the last split the car has reached this lap (0 = the first timing point). */
  point: number
  /** Points reached this lap. */
  pointsReached: number
  /** Seconds from the line to that point. */
  elapsed: number
  /** Projected lap time. */
  projected: number
  /** The lap if the car matched its best so far through every remaining stretch (never slower than `projected`). Not
   * a floor: drivers improve through a session (new tyres, a rubbered-in track), so laps can beat it. */
  optimistic: number
  /** Elapsed minus the car's best lap at the same point (negative = up on its best); null when unknown. */
  deltaToBest: number | null
  basis: ProjectionBasis
  /** On a push lap (see PROJECTION_TUNING), as opposed to a cool-down or abandoned lap. */
  pushing: boolean
}

export const PROJECTION_TUNING = {
  /** Points the car must have crossed this lap before it can count as pushing (one point is too little to go on). */
  minPoints: 2,
  /** Furthest behind its own best at the last point and still pushing, on the first flying lap of a run and later. */
  maxDeltaFirstLap: 1.5,
  maxDelta: 1.0,
  /** No crossing for this long: the car has stopped or the data has (red flag, lost connection). */
  staleSeconds: 60,
}

/** Index of the last split reached (excluding the lap time), or -1. */
function lastReached(splits: number[]): number {
  for (let k = splits.length - 2; k >= 0; k--) if (splits[k] > 0) return k
  return -1
}

/** Median of the positive values, or 0. */
function median(values: number[]): number {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b)
  return v.length === 0 ? 0 : v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
}

/**
 * A car's best time through each stretch, from timed laps only. Natsoft's stretch bests include out-laps (the
 * mini-sector colours use them), so before a car's first timed lap they're out-lap times, 20 s+ slow over a lap
 * (found with the backtest): no timed lap yet, no stretch times of its own.
 */
function ownStretches(car: CarRow): number[] {
  return car.bestLap > 0 ? car.bestSegments ?? [] : []
}

/** The field's median best time through each stretch (index as `bestSegments`), from cars with a timed lap. */
export function fieldStretches(cars: CarRow[]): number[] {
  const timed = cars.map(ownStretches).filter((s) => s.length > 0)
  const n = Math.max(0, ...timed.map((s) => s.length))
  return Array.from({ length: n }, (_, k) => median(timed.map((s) => s[k] ?? 0)))
}

/** Sum of stretches from+1 to the line (the last index), each from `own` or else `field`; null if any is unknown. */
function restOf(from: number, own: number[], field: number[], allowField: boolean): number | null {
  const last = Math.max(own.length, field.length) - 1
  if (last < 0) return null
  let sum = 0
  for (let k = from + 1; k <= last; k++) {
    const t = own[k] > 0 ? own[k] : allowField ? field[k] : 0
    if (!(t > 0)) return null
    sum += t
  }
  return sum
}

/**
 * The projection for one car, or null when it isn't on a timed lap (out-lap, pit lane, no point crossed yet, no data
 * for the rest of the lap). `field` is fieldStretches(timing.cars), passed in so it's worked out once per snapshot.
 */
export function projectLap(car: CarRow, now: number, field: number[], tuning = PROJECTION_TUNING): LapProjection | null {
  if (car.inPit || car.lapsSincePit < 1 || !(car.lapStartAt > 0)) return null
  if (car.lastPointAt > 0 && now - car.lastPointAt > tuning.staleSeconds) return null
  const splits = car.currentSplits ?? []
  const k = lastReached(splits)
  if (k < 0) return null
  const elapsed = splits[k]
  const best = car.bestLapSplits ?? []
  const own = ownStretches(car)
  const lapIndex = splits.length - 1

  let basis: ProjectionBasis
  let rest: number | null
  if (best[lapIndex] > 0 && best[k] > 0 && best[lapIndex] > best[k]) {
    basis = 'best-lap'
    rest = best[lapIndex] - best[k]
  } else if ((rest = restOf(k, own, field, false)) !== null) {
    basis = 'best-stretches'
  } else {
    basis = 'field'
    rest = restOf(k, own, field, true)
  }
  if (rest === null) return null
  const projected = elapsed + rest
  const optimisticRest = restOf(k, own, field, true)
  const optimistic = optimisticRest === null ? projected : Math.min(projected, elapsed + optimisticRest)

  const deltaToBest = best[k] > 0 ? elapsed - best[k] : null
  // Pushing: close enough to its own best at the last point. Its best lap's split there if known, else its best
  // stretches so far (a best lap set before we connected only has splits at the intermediates). Nothing of its own
  // to compare with (first flying lap of the session): it can't be told from a slow lap, so it counts as pushing.
  const bestSoFar = restOf(-1, own.slice(0, k + 1), [], false)
  const reference = best[k] > 0 ? best[k] : bestSoFar
  const limit = car.lapsSincePit === 1 ? tuning.maxDeltaFirstLap : tuning.maxDelta
  const pushing = k + 1 >= tuning.minPoints && (reference === null || elapsed - reference <= limit)

  return { carId: car.id, point: k, pointsReached: k + 1, elapsed, projected, optimistic, deltaToBest, basis, pushing }
}

/** Projections for every car on a timed lap, keyed by car id. */
export function projectLaps(timing: Pick<TimingSnapshot, 'cars' | 'now'>, tuning = PROJECTION_TUNING): Map<string, LapProjection> {
  const field = fieldStretches(timing.cars)
  const out = new Map<string, LapProjection>()
  for (const car of timing.cars) {
    const p = projectLap(car, timing.now, field, tuning)
    if (p) out.set(car.id, p)
  }
  return out
}

/**
 * Where a projected lap would put the car in a session ranked by best lap: 1 + the other cars with a quicker best.
 * Only meaningful when it would improve the car's own best (`improves`); otherwise the car keeps its place.
 */
export function projectedPosition(projected: number, car: CarRow, cars: CarRow[]): { position: number; improves: boolean } {
  const improves = !(car.bestLap > 0) || projected < car.bestLap
  const time = improves ? projected : car.bestLap
  return { position: 1 + cars.filter((c) => c.id !== car.id && c.bestLap > 0 && c.bestLap < time).length, improves }
}
