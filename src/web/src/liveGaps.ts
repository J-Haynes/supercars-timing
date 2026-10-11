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
