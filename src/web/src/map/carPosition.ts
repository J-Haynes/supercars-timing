import type { CarRow } from '../types'
import type { TrackModel } from './trackModel'

export type CarMapState =
  | { kind: 'track'; distance: number; stale: boolean; overdue: boolean }
  | { kind: 'pit' }
  | { kind: 'unknown' }

/**
 * Estimates where a car is on the lap.
 *
 * Natsoft only tells us the last timing point each car passed and when. We assume the car keeps the
 * pace it (or the field) had through the same segment last time, and convert "fraction of the segment's
 * time elapsed" into distance using the simulated speed profile, so cars slow for corners and speed up
 * on straights instead of moving at a constant rate.
 *
 * @param order point order: "M" then the snapshot's timing point IDs
 * @param now   estimated current Natsoft time (seconds)
 */
export function carPosition(
  car: CarRow, track: TrackModel, order: string[], fallback: number[], now: number,
  /** Optional upper bound per segment (seconds). See TrackMap: used outside races. */
  cap?: number[],
): CarMapState {
  if (car.inPit) return { kind: 'pit' }
  const i = order.indexOf(car.lastPoint)
  const from = track.pointDistance.get(car.lastPoint)
  if (i < 0 || from === undefined || !car.lastPointAt) return { kind: 'unknown' }

  const nextId = order[(i + 1) % order.length]
  let to = track.pointDistance.get(nextId) ?? from
  if (to <= from) to += track.length // the segment crosses the control line

  // segmentSeconds may be missing if the server is older than the frontend.
  let expected = car.segmentSeconds?.[i] || fallback[i] || 0
  // Outside races a car's "recent pace" is often an out-lap or cool-down lap. Capping it near the
  // track's typical racing pace keeps flying laps smooth; a slow car simply waits at the next point.
  if (cap?.[i]) expected = Math.min(expected || Infinity, cap[i] * 1.12)
  if (expected <= 0) return { kind: 'track', distance: track.wrap(from), stale: false, overdue: false }

  const elapsed = Math.max(0, now - car.lastPointAt)
  // Hold just short of the next point if the car is late: it hasn't crossed yet, so it can't be past it.
  const fraction = Math.min(elapsed / expected, 0.99)
  const stale = elapsed > expected * 2.5
  const overdue = elapsed > expected

  // Same fraction of the *simulated* time through this segment, then back to distance.
  const lap = track.lapSimTime
  const t0 = track.simTimeAt(from)
  const t1 = to > track.length ? lap + track.simTimeAt(to - track.length) : track.simTimeAt(to)
  const target = t0 + fraction * (t1 - t0)
  const distance = target > lap ? track.length + track.distanceAtSimTime(target - lap) : track.distanceAtSimTime(target)
  return { kind: 'track', distance: track.wrap(distance), stale, overdue }
}
