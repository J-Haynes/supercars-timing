import type { CarRow } from './types'

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

/** Seconds `car` is behind `ref` at the last timing point it crossed, or null when we can't tell. */
export function liveGap(car: CarRow, ref: CarRow, order: string[]): number | null {
  if (car.inPit || !car.lastPoint || car.id === ref.id) return null
  const lapNo = car.laps + 1
  const mine = crossingTime(car, order, car.lastPoint, lapNo)
  const theirs = crossingTime(ref, order, car.lastPoint, lapNo)
  if (mine === null || theirs === null || mine < theirs) return null
  return mine - theirs
}

/** When `car` crossed its latest timing point: exact where Natsoft gives it (line, I1/I2), else message time. */
function latestCrossing(car: CarRow, order: string[]): number {
  return crossingTime(car, order, car.lastPoint, car.laps + 1) ?? (car.lastPointAt || Number.MAX_VALUE)
}

/**
 * The race order on the road. Natsoft only re-orders positions at the control line, so a pass at Hell Corner
 * doesn't show until the cars complete the lap (Bathurst 2026: Lowndes was ahead of Best at every timing point for
 * a whole lap while Natsoft still had Best ahead). This orders by laps completed, then the furthest timing point
 * reached, then who reached it first. At the line it agrees with Natsoft (351 of 353 crossings).
 * Cars in the pit lane keep Natsoft's position: their last timing point can be minutes old.
 */
export function roadOrder(cars: CarRow[], order: string[]): CarRow[] {
  const byNatsoft = [...cars].sort((a, b) => (a.position || 999) - (b.position || 999))
  const onTrack = byNatsoft
    .filter((c) => !c.inPit)
    .sort((a, b) =>
      b.laps - a.laps
      || order.indexOf(b.lastPoint) - order.indexOf(a.lastPoint)
      || latestCrossing(a, order) - latestCrossing(b, order)
      || (a.position || 999) - (b.position || 999))
  // Pit-lane cars go back into their Natsoft slots; everyone else fills the gaps in road order.
  const result: CarRow[] = []
  let next = 0
  byNatsoft.forEach((car, slot) => {
    if (car.inPit) result[slot] = car
  })
  for (let slot = 0; slot < byNatsoft.length; slot++) {
    if (!result[slot]) result[slot] = onTrack[next++]
  }
  return result
}
