import type { CarRow, TimingSnapshot } from './types'
import { flagKind } from './session'

/**
 * Race gaps that update at every timing point, not just once a lap.
 *
 * Natsoft's GI/GNI only change when a car crosses the control line. Its LGI/LGNI change at every timing point but
 * are often out of order with the running positions (2.2 inversions per check vs 0.2 for GI, Bathurst 1000 2026),
 * so we work gaps out ourselves: each car's crossing time at every timing point is lapStartAt + its split there
 * (this lap or last lap). A car's gap is the difference between its latest crossing and the leader's crossing of
 * the same point on the same lap. At the control line this matches GI exactly (checked live, 69 crossings).
 */

/** Natsoft time `car` crossed `point` at the start of / during lap `lapNo` (the lap being driven, 1-based). */
function crossingTime(car: CarRow, order: string[], point: string, lapNo: number): number | null {
  if (car.lapStartAt <= 0) return null
  const currentLap = car.laps + 1
  const previousLapStart = car.lastLap > 0 ? car.lapStartAt - car.lastLap : 0
  // Crossing the control line starts a lap.
  if (point === 'M') {
    if (lapNo === currentLap) return car.lapStartAt
    if (lapNo === currentLap - 1 && previousLapStart > 0) return previousLapStart
    return null
  }
  const i = order.indexOf(point) - 1 // splits are [TP1..TPn, lap]; order is ['M', TP1..TPn]
  if (i < 0) return null
  if (lapNo === currentLap) return car.currentSplits[i] > 0 ? car.lapStartAt + car.currentSplits[i] : null
  if (lapNo === currentLap - 1 && previousLapStart > 0) {
    return car.lastLapSplits[i] > 0 ? previousLapStart + car.lastLapSplits[i] : null
  }
  return null
}

/**
 * Seconds `car` is behind `ref` at the last timing point it crossed, or null when we can't tell.
 * The car's own crossing falls back to its message time: on an out-lap it has no lap start (that's set at its next
 * line crossing), and Natsoft's GI is still the gap from the pit lane, before the stop (Seton showed +5.6 s while
 * actually 53 s behind).
 */
export function liveGap(car: CarRow, ref: CarRow, order: string[]): number | null {
  if (car.inPit || parkedAtLine(car) || !car.lastPoint || car.id === ref.id) return null
  const lapNo = car.laps + 1
  const mine = crossingTime(car, order, car.lastPoint, lapNo) ?? (car.lastPointAt || null)
  const theirs = crossingTime(ref, order, car.lastPoint, lapNo)
  if (mine === null || theirs === null || mine < theirs) return null
  return mine - theirs
}

/**
 * A car that crossed the control line in the pit lane (it's in the pits, or has left but not reached the next timing
 * point). It's effectively parked at the line, so every car on the same lap that crosses the line afterwards has
 * passed it. LapsSincePit only counts line crossings out of the pits, so 0 + "M" means the last crossing was in it.
 */
export function parkedAtLine(car: CarRow): boolean {
  return car.lastPoint === 'M' && (car.inPit || car.lapsSincePit === 0)
}

/** When `car` crossed its latest timing point: exact where Natsoft gives it (line, I1/I2), else message time. */
function latestCrossing(car: CarRow, order: string[]): number {
  if (parkedAtLine(car)) return Number.MAX_VALUE // behind everyone who has crossed the line on this lap
  return crossingTime(car, order, car.lastPoint, car.laps + 1) ?? (car.lastPointAt || Number.MAX_VALUE)
}

/**
 * The race order on the road. Natsoft only re-orders official positions at the control line, so a pass at Hell Corner
 * doesn't show until the cars complete the lap (Bathurst 2026: Lowndes was ahead of Best at every timing point for
 * a whole lap while Natsoft still had Best ahead). This orders by laps completed, then the furthest timing point
 * reached, then who reached it first. At the line it agrees with Natsoft (351 of 353 crossings).
 *
 * Pit stops: Natsoft keeps a pitting car ahead of the cars on its lap until they complete another lap (#9 on lap 16
 * held P18 for ~130 s, then dropped six places at once). Here it drops as each car passes the pit lane (P18 to P24
 * within 19 s of crossing the line in the pit lane), see parkedAtLine().
 */
export function roadOrder(cars: CarRow[], order: string[]): CarRow[] {
  // Natsoft sends its own road position at every timing point (<P LP>), which also handles pit stops. Use it when
  // every car has one and they're all different; otherwise work it out (older servers, gaps in the data).
  const natsoft = cars.map((c) => c.roadPosition ?? 0)
  if (natsoft.every((p) => p > 0) && new Set(natsoft).size === natsoft.length) {
    return [...cars].sort((a, b) => (a.roadPosition ?? 0) - (b.roadPosition ?? 0))
  }
  return [...cars].sort((a, b) =>
    b.laps - a.laps
    || order.indexOf(b.lastPoint) - order.indexOf(a.lastPoint)
    || latestCrossing(a, order) - latestCrossing(b, order)
    || (a.position || 999) - (b.position || 999))
}

/**
 * The race order to show: the road order while racing, and Natsoft's official classification once the chequered flag
 * is out. After the finish Natsoft stops counting laps but keeps sending timing points from the cool-down lap, and
 * stops updating stopped cars' road positions, so the road order would rank cars by how far round the cool-down lap
 * they are (Bathurst 1000: the winner dropped down the tower after the flag).
 */
export function raceOrder(timing: TimingSnapshot): CarRow[] {
  if (raceFinished(timing)) return [...timing.cars].sort((a, b) => (a.position || 999) - (b.position || 999))
  return roadOrder(timing.cars, ['M', ...timing.timingPoints.map((p) => p.id)])
}

/** True once the session's chequered flag is out (positions and gaps are then Natsoft's official ones). */
export function raceFinished(timing: TimingSnapshot): boolean {
  return flagKind(timing.session.flag) === 'finished'
}
