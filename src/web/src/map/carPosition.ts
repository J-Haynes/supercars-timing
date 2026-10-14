import type { CarRow } from '../types'
import type { TrackModel } from './trackModel'

export type CarMapState =
  | { kind: 'track'; distance: number; stale: boolean; overdue: boolean }
  | { kind: 'pit' }
  | { kind: 'unknown' }

/** Visual pacing allowance (see where it's used). Doesn't affect `overdue`/`stale`, which other logic relies on. */
export const VISUAL_SLACK = 1.04

/**
 * How the map paces cars between timing points, per series.
 * - slack: expect the stretch to take this much longer than last time (visual only)
 * - skipAfter: a car this late (x the expected time, beyond 1) is assumed past the next point (its crossing skipped)
 * - creepFrom: under green too, a late car eases in towards the next point from this fraction on
 */
export interface Pacing {
  slack: number
  skipAfter?: number
  creepFrom?: number
}

/** Tuned at the Bathurst 1000 (Natsoft: few, long stretches). */
export const SUPERCARS_PACING: Pacing = { slack: VISUAL_SLACK }

/**
 * F1's mini-sectors, tuned offline against real car positions (Position.z) in five 2025 races (Qatar, Sao Paulo,
 * Mexico City, Austin, Singapore; scratch script, 11 Oct 2026). Against the Supercars settings: frozen dots 1.5 % ->
 * 0.1 % of the time, average error under green 13.7 -> 12.5 m (the slack kept cars ~7 m behind), speed glitches
 * 7.1 -> 5.9 %, safety car error 25.3 -> 26.1 m. Smarter pace guesses (recent pace ratio, cars just through the
 * stretch, the car ahead) were no better than each car's own last time through the stretch.
 */
export const F1_PACING: Pacing = { slack: 1.0, skipAfter: 0.3, creepFrom: 0.9 }

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

/** Expected seconds for the stretch from point i (see carPosition for the rules). */
function expectedSeconds(
  car: CarRow, i: number, order: string[], fallback: number[], cap: number[] | undefined, baseline: number[] | undefined,
  caution: CautionPace | undefined,
): number {
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
  return expected
}

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
  /** Pacing settings for the series (SUPERCARS_PACING or F1_PACING). */
  pacing: Pacing = SUPERCARS_PACING,
): CarMapState {
  if (car.inPit) return { kind: 'pit' }
  const i = order.indexOf(car.lastPoint)
  const from = track.pointDistance.get(car.lastPoint)
  if (i < 0 || from === undefined || !car.lastPointAt) return { kind: 'unknown' }

  const expected = expectedSeconds(car, i, order, fallback, cap, baseline, caution)
  if (expected <= 0) return { kind: 'track', distance: track.wrap(from), stale: false, overdue: false }

  const elapsed = Math.max(0, now - car.lastPointAt)
  const stale = elapsed > expected * 2.5
  const overdue = elapsed > expected
  // Hold just short of the next point if the car is late: it hasn't crossed yet, so it can't be past it.
  // For the animation only, assume the stretch takes a little longer than last time: a car a few tenths slower
  // would otherwise reach 99% and wait there until its crossing arrives (measured at every timing point, median
  // 0.4 s). Arriving a few metres "early" is taken up by the smoothing in map/smoothing.ts instead.
  const raw = elapsed / (expected * pacing.slack)
  // F1 doesn't send every mini-sector (about 4 % are skipped): a car waiting for a crossing that never comes froze
  // until the one after. Once it's this late, assume the crossing was skipped and carry on through the next stretch.
  if (pacing.skipAfter !== undefined && raw > 1 + pacing.skipAfter) {
    const j = (i + 1) % order.length
    const nextFrom = track.pointDistance.get(order[j])
    const nextExpected = expectedSeconds(car, j, order, fallback, cap, baseline, caution)
    if (nextFrom !== undefined && nextExpected > 0) {
      const raw2 = (elapsed - expected * pacing.slack * (1 + pacing.skipAfter)) / (nextExpected * pacing.slack)
      return { kind: 'track', distance: place(track, nextFrom, order[(j + 1) % order.length], ease(raw2, caution, pacing)), stale, overdue }
    }
  }
  return { kind: 'track', distance: place(track, from, order[(i + 1) % order.length], ease(raw, caution, pacing)), stale, overdue }
}

/**
 * Fraction of the stretch to draw for `raw` (elapsed / expected). A late car eases in towards the next point from
 * creepFrom on (same speed there, slowing smoothly) instead of driving to 99% and freezing; the smoothing glides it
 * on when the crossing arrives. Under a caution always (SC pace varies by stretch); under green if the series' pacing
 * says so.
 */
function ease(raw: number, caution: CautionPace | undefined, pacing: Pacing): number {
  const from = caution ? CAUTION_TUNING.creepFrom : pacing.creepFrom
  return from !== undefined && raw > from
    ? Math.min(from + (0.99 - from) * (1 - Math.exp(-(raw - from) / (0.99 - from))), 0.99)
    : Math.min(Math.max(raw, 0), 0.99)
}

/** Distance at `fraction` of the *simulated* time through the stretch from `from` to point `toId`. */
export function place(track: TrackModel, from: number, toId: string, fraction: number): number {
  return placeBetween(track, from, track.pointDistance.get(toId) ?? from, fraction)
}

/** Distance at `fraction` of the simulated time from distance `from` to distance `to` (either may be any lap distance). */
export function placeBetween(track: TrackModel, from: number, to: number, fraction: number): number {
  from = track.wrap(from)
  to = track.wrap(to)
  if (to <= from) to += track.length // the segment crosses the control line
  const lap = track.lapSimTime
  const t0 = track.simTimeAt(from)
  const t1 = to > track.length ? lap + track.simTimeAt(to - track.length) : track.simTimeAt(to)
  const target = t0 + fraction * (t1 - t0)
  const distance = target > lap ? track.length + track.distanceAtSimTime(target - lap) : track.distanceAtSimTime(target)
  return track.wrap(distance)
}
