import type { CarRow } from '../types'
import type { TrackModel } from './trackModel'

export type CarMapState =
  | { kind: 'track'; distance: number; stale: boolean; overdue: boolean }
  | { kind: 'pit' }
  | { kind: 'unknown' }

/** Visual pacing allowance (see where it's used). Doesn't affect `overdue`/`stale`, which other logic relies on. */
export const VISUAL_SLACK = 1.04

export interface CautionPace {
  /** Natsoft time the caution started. */
  since: number
  /** The field's pace under it, as a multiple of the track's typical stretch times. */
  fieldRatio: number
  /** Per stretch (point order): what cars took through it under this caution (75th percentile); undefined = none yet. */
  stretchSeconds: (number | undefined)[]
}

/**
 * Caution pacing settings (see carPosition / cautionPace). Tuned on the Bathurst 1000's first safety car, replayed
 * offline: they balance cars waiting at points (estimate too fast) against big catch-up glides (too slow).
 * - creepFrom: where a late car starts easing in towards the next point (fraction of the stretch)
 * - pace: the field's caution pace (x racing) assumed until a few cars have done a stretch under it
 * - percentile: which of the cars' times through a stretch under the caution to expect
 */
export const CAUTION_TUNING = { creepFrom: 0.85, pace: 1.3, percentile: 0.75 }

/**
 * The car's time through the stretch it last completed, as a multiple of the track's typical time for it. Only if
 * the whole stretch was after `since` (a stretch begun under green and finished under the caution is mixed).
 */
function lastStretchRatio(car: CarRow, order: string[], baseline: number[], since: number): number | undefined {
  const i = order.indexOf(car.lastPoint)
  // Out-laps are slower than the safety car queue (many cars pit under it): they'd inflate the pace.
  if (i < 0 || car.inPit || car.lapsSincePit === 0) return undefined
  const prev = (i - 1 + order.length) % order.length
  const time = i > 0 ? car.currentSegments?.[prev] : car.lastLapSegments?.[prev]
  if (!time || time <= 0 || !baseline[prev] || car.lastPointAt - time < since) return undefined
  return time / baseline[prev]
}

/**
 * The field's pace under a caution: the 75th percentile of each car's last-stretch ratio, counting only stretches
 * entirely under the caution. Upper quartile, not median: cars still closing up to the queue are quicker than the
 * safety car's pace and would pull it down (Bathurst 1000: median 1.63x vs ~2.1x for the queue). Falls back to a
 * typical SC pace until a few cars have one.
 */
/** Stretches finished this recently count towards the caution pace (it changes as the field bunches, then settles). */
const RECENT_SECONDS = 90

export function cautionPace(cars: CarRow[], order: string[], baseline: number[], since: number, now: number): CautionPace {
  const ratios = cars
    .map((c) => lastStretchRatio(c, order, baseline, since))
    .filter((r): r is number => r !== undefined && r > 0.8 && r < 4)
    .sort((a, b) => a - b)
  return { since, fieldRatio: ratios.length >= 3 ? ratios[Math.floor(ratios.length * 0.75)] : CAUTION_TUNING.pace, stretchSeconds: stretchTimes(cars, order, since, now) }
}

/**
 * For each stretch, the times cars took through it entirely under the caution (started and finished after `since`),
 * 75th percentile, from this lap's stretches (finish = lap start + split at the stretch's end point) and the last
 * lap's final stretch (finish = this lap's start). Undefined where fewer than 2 cars have one.
 */
function stretchTimes(cars: CarRow[], order: string[], since: number, now: number): (number | undefined)[] {
  const byStretch: number[][] = order.map(() => [])
  for (const c of cars) {
    // Out-laps are slower than the queue; the pace also changes during a caution, so only recent stretches count.
    if (c.inPit || !c.lapStartAt || c.lapsSincePit === 0) continue
    order.forEach((_, i) => {
      const last = i === order.length - 1
      const time = last ? c.lastLapSegments?.[i] : c.currentSegments?.[i]
      const end = last ? c.lapStartAt : c.currentSplits?.[i] > 0 ? c.lapStartAt + c.currentSplits[i] : 0
      if (time > 0 && end > 0 && end - time >= since && now - end <= RECENT_SECONDS) byStretch[i].push(time)
    })
  }
  return byStretch.map((t) => (t.length >= 2 ? t.sort((a, b) => a - b)[Math.floor(t.length * CAUTION_TUNING.percentile)] : undefined))
}

/** Out-lap pace (x typical) before the car has completed a stretch. Checked against Bathurst recordings. */
const OUT_LAP_PACE = 1.3

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
  /** The track file's typical time per segment, used to estimate out-lap and caution pace. */
  baseline?: number[],
  /** While a safety car / FCY is out: when it started and the field's pace under it (see cautionPace). */
  caution?: CautionPace,
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
  // Out-laps are slow and uneven (the queue out of pit lane at the start of practice can take 2-3x racing pace),
  // so neither the cap nor the car's flying-lap pace fits: it would race ahead and wait at the next point.
  // Expect the same pace, relative to the track's typical times, as the car's previous stretch this lap.
  if (car.lapsSincePit === 0 && baseline?.[i]) {
    const prevTime = car.currentSegments?.[i - 1] ?? 0
    const ratio = i > 0 && prevTime > 0 && baseline[i - 1] ? prevTime / baseline[i - 1] : OUT_LAP_PACE
    expected = Math.max(expected, baseline[i] * Math.min(Math.max(ratio, 1), 3))
  }
  // Safety car / FCY: cars take ~2x their normal time through each stretch (Bathurst 1000: 31.9 s vs 15.1 s), but
  // their expected times are racing pace, so they'd race ahead and wait at every point. Expect the pace of the
  // car's last stretch under the caution, or the field's caution pace for its first one.
  // Safety car pace varies a lot from stretch to stretch (Bathurst 1000: 1.7x through one, 2.9x through the next as
  // the queue bunched), but the cars run nose to tail, so the best guess is what cars took through this same stretch
  // under this caution. Leans slow: a car ahead of its real position waits at the next point (looks broken), while
  // one behind just glides forward when its crossing arrives (map/smoothing.ts).
  // Only stretches the car started after the caution came out: one begun under green is still driven at speed
  // (paced at SC speed, cars ended up 400 m behind).
  if (caution && baseline?.[i] && car.lastPointAt > caution.since) {
    const sameStretch = caution.stretchSeconds[i]
    if (sameStretch) {
      // Cars differ a lot under a safety car: those still closing up to the queue are much quicker than it (21.7 s
      // vs the queue's 39.2 s through one stretch). Scale by how this car compared with the field last stretch.
      const prev = (i - 1 + order.length) % order.length
      const ownPrev = i > 0 ? car.currentSegments?.[prev] : car.lastLapSegments?.[prev]
      const fieldPrev = caution.stretchSeconds[prev]
      const rel = ownPrev && ownPrev > 0 && fieldPrev ? Math.min(Math.max(ownPrev / fieldPrev, 0.5), 1.5) : 1
      expected = Math.max(expected, sameStretch * rel)
    } else {
      // No car through this stretch under the caution yet. Cars keep near racing pace until they catch the queue
      // (Bathurst 1000: ~16 s stretches in the first minute), so use the car's own latest stretch pace, whatever
      // the flag was; the ease-in handles a car that then slows more.
      const own = lastStretchRatio(car, order, baseline, Number.NEGATIVE_INFINITY)
      const ratio = own ?? caution.fieldRatio
      expected = Math.max(expected, baseline[i] * Math.min(Math.max(ratio, 1), 3))
    }
  }
  if (expected <= 0) return { kind: 'track', distance: track.wrap(from), stale: false, overdue: false }

  const elapsed = Math.max(0, now - car.lastPointAt)
  // Hold just short of the next point if the car is late: it hasn't crossed yet, so it can't be past it.
  // For the animation only, assume the stretch takes a little longer than last time: a car a few tenths slower
  // would otherwise reach 99% and wait there until its crossing arrives (measured at every timing point, median
  // 0.4 s). Arriving a few metres "early" is taken up by the smoothing in map/smoothing.ts instead.
  const raw = elapsed / (expected * VISUAL_SLACK)
  // Under a caution a car can be very late (SC pace varies by stretch). Rather than drive to 99% and freeze, it
  // eases in towards the point from 85% on (same speed at 85%, slowing smoothly), and the smoothing glides it on
  // when the crossing arrives. Green flag: unchanged.
  const fraction = caution && raw > CAUTION_TUNING.creepFrom
    ? Math.min(CAUTION_TUNING.creepFrom + (0.99 - CAUTION_TUNING.creepFrom) * (1 - Math.exp(-(raw - CAUTION_TUNING.creepFrom) / (0.99 - CAUTION_TUNING.creepFrom))), 0.99)
    : Math.min(raw, 0.99)
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
