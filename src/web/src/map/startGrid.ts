import type { CarRow, SessionInfo } from '../types'
import { startPosition } from '../startingGrid'
import type { TrackModel } from './trackModel'
import { placeBetween } from './carPosition'
import type { Crossing } from './crossingLog'

/**
 * Cars on the starting grid before a race, and their launch to the first timing point after the green flag.
 *
 * The feeds say nothing about the grid itself: at the Bathurst 1000 (Race 30) no car crossed a timing point before
 * the green, so the map was empty until the field reached point 1 ~15 s after it; at the 2026 Singapore GP the last
 * crossing before the green was the end of the formation lap (`M`, 50-70 s before). So the map draws its own grid,
 * in grid order, and moves each car from its slot to its first crossing after the green.
 */

/**
 * Grid slots as drawn: pole this far behind the control line, each place a further GRID_SPACING back, alternating
 * sides of the track by GRID_SIDE metres. A drawing approximation (where each track's start line and grid boxes are
 * isn't in our track files), so the field sits on the straight behind the line in a staggered two-wide grid.
 */
const POLE_BEHIND_LINE = 10
const GRID_SPACING = 8
const GRID_SIDE = 3.5

/**
 * Seconds a car loses from a standing start against its flying-lap pace over the same distance. Measured from the
 * green flag to each car's first crossing: Bathurst 1000 pole 1.8 s (14.7 s to point 1 vs 12.9 s flying); 2025 and
 * 2026 Singapore GP pole 2.8 s (8.2 s to mini-sector 1.2 vs 5.4 s). Only used when the first crossing isn't known yet
 * (live without a broadcast delay). 1.5 s with the ease-in near the point: at Bathurst each car was drawn a median
 * 44 m (35-68 m) short of point 1 when its crossing came (2.5 s: 63 m), then glides there. Short on purpose: a car
 * drawn past its real position would have to wait at the point.
 */
const LAUNCH_LOSS = 1.5

/** A grid slot: distance along the lap (behind the line) and sideways offset (metres, left of race direction). */
export interface GridSlot {
  distance: number
  lateral: number
}

/** The slot for grid place `place` (1 = pole). */
export function gridSlot(track: TrackModel, place: number): GridSlot {
  const i = Math.max(place, 1) - 1
  return { distance: track.wrap(-(POLE_BEHIND_LINE + i * GRID_SPACING)), lateral: i % 2 === 0 ? GRID_SIDE : -GRID_SIDE }
}

/**
 * Grid places for the cars that will start from the grid: the starting grid when we know it (F1's grid positions, the
 * hand-entered Supercars grids), else the running order before the start (Natsoft's order then is the grid). Ranked
 * 1..n so the drawn grid has no holes for cars in the pit lane.
 */
export function gridPlaces(session: SessionInfo, cars: CarRow[]): Map<string, number> {
  const ranked = cars
    .filter((c) => !c.inPit && !c.retired)
    .map((c) => ({ id: c.id, key: startPosition(session, c) ?? (c.position || 99), number: c.carNumber }))
    .sort((a, b) => a.key - b.key || a.number.localeCompare(b.number, undefined, { numeric: true }))
  return new Map(ranked.map((c, i) => [c.id, i + 1]))
}

/**
 * Before the start: is this car on the grid? Yes if it hasn't crossed a timing point yet, if its last crossing was the
 * end of a lap (the formation lap ended at the line, or the last point before it: it's then drawn driving into its
 * slot, see formationArrival), or if its last crossing is old (a car that crossed one in a practice start long ago).
 * Cars with a recent crossing elsewhere are on the formation lap and are placed like any other car.
 */
export function onGrid(car: CarRow, order: string[], now: number): boolean {
  if (car.inPit || car.laps > 0) return false
  if (!car.lastPoint || !car.lastPointAt) return true
  return car.lastPoint === 'M' || car.lastPoint === order[order.length - 1] || now - car.lastPointAt > 180
}

/**
 * Where a car on the grid is drawn before the start. A car that has just crossed the last timing point of the
 * formation lap drives on into its slot at the pace it would take through that stretch, slowing to a stop there
 * (instead of driving on to the line and jumping back).
 */
export function preStartDistance(track: TrackModel, car: CarRow, order: string[], slot: GridSlot, stretchSeconds: number, now: number): number {
  const last = order[order.length - 1]
  const from = track.pointDistance.get(car.lastPoint)
  if (car.lastPoint !== last || last === 'M' || from === undefined || !car.lastPointAt || stretchSeconds <= 0) return slot.distance
  // Formation laps are slow: about twice racing pace (Singapore GP 2026: 3.7 -> line in ~10 s vs ~5 s flying).
  const f = Math.min(Math.max((now - car.lastPointAt) / (stretchSeconds * 2), 0), 1)
  // The slot can be behind the last point (a short final stretch): then just show the car in its slot.
  if (track.wrap(slot.distance - from) > track.length / 2) return slot.distance
  return placeBetween(track, from, slot.distance, 1 - (1 - f) ** 2) // decelerating into the slot
}

/**
 * From a standstill: the fraction of the distance covered at time fraction `f` of the run. Accelerates evenly for the
 * first half of the time, then holds that speed (ends 1.33x the average speed). Applied to distance directly, not
 * through the track's flying-lap speed profile (placeBetween): that profile is fastest on the straight the grid is
 * on, and cars launched along it reached 90 m/s four seconds after the green (Singapore GP 2026).
 */
export function launchFraction(f: number): number {
  const a = 0.5
  const x = Math.min(Math.max(f, 0), 1)
  return x < a ? (x * x) / (2 * a) / (1 - a / 2) : (x - a / 2) / (1 - a / 2)
}

/**
 * Where a car is between the green flag and its first crossing after it: from its grid slot to that crossing.
 * - `next` known (a replay's lookahead or a broadcast delay): exactly on time.
 * - else estimated: its flying-lap time from the slot to the first timing point (`stretches`: seconds per stretch
 *   from the line, scaled for the extra distance behind it) plus LAUNCH_LOSS, holding just short of the point if it's
 *   late. With `skipAfter` (F1: its first mini-sector is rarely sent at a start, 1 car of 18 at Singapore 2026), a car
 *   that late is assumed past it and carries on towards the second point, like carPosition.
 */
export function launchDistance(
  track: TrackModel, slot: GridSlot, green: number, now: number, order: string[], next: Crossing | undefined, stretches: number[],
  skipAfter?: number,
): number {
  // Only a crossing within the first two points: further on (a hole in the crossing log, e.g. a live page loaded
  // mid-launch with a broadcast delay), aiming at it put cars hundreds of metres short of point 1. F1 often skips
  // its first mini-sector (1.2 is the first crossing), so the second point is allowed.
  const reach = track.pointDistance.get(order[2] ?? order[1] ?? '') ?? 0
  const nextAt = next && next.at > green ? track.pointDistance.get(next.point) : undefined
  if (next && nextAt !== undefined && nextAt > 0 && nextAt <= reach) {
    return along(track, slot.distance, nextAt, launchFraction((now - green) / (next.at - green)))
  }
  const first = estimateTo(track, slot, green, now, order, stretches, 1)
  if (!first) return slot.distance
  if (skipAfter === undefined || first.late <= 1 + skipAfter) return first.distance
  // Past the first point by now: whichever is further on (the second estimate starts behind the first one).
  const second = estimateTo(track, slot, green, now, order, stretches, 2)
  return second && track.wrap(second.distance - slot.distance) > track.wrap(first.distance - slot.distance) ? second.distance : first.distance
}

/** The estimated launch towards timing point order[k] (see launchDistance), and how late the car is there (x expected). */
function estimateTo(track: TrackModel, slot: GridSlot, green: number, now: number, order: string[], stretches: number[], k: number) {
  const to = order[k] ? track.pointDistance.get(order[k]) : undefined
  const flying = stretches.slice(0, k).reduce((a, b) => a + b, 0)
  if (to === undefined || to <= 0 || flying <= 0) return undefined
  const metres = to + (track.length - slot.distance)
  const expected = flying * (metres / to) + LAUNCH_LOSS
  // Ease in near the point when late, like carPosition under a caution: never past a point not yet crossed.
  const f = (now - green) / expected
  const shown = f < 0.85 ? f : 0.85 + 0.14 * (1 - Math.exp(-(f - 0.85) / 0.14))
  return { distance: along(track, slot.distance, to, launchFraction(Math.min(shown, 0.99))), late: f }
}

/** `fraction` of the way from distance `from` to distance `to`, forwards round the lap. */
function along(track: TrackModel, from: number, to: number, fraction: number): number {
  return track.wrap(from + track.wrap(to - from) * fraction)
}
