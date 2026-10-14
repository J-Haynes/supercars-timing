import type { TimingUpdate } from '../types'
import type { TrackModel } from './trackModel'
import { place } from './carPosition'
import { MAX_DELAY_SECONDS } from '../useDelayedUpdate'

export interface Crossing {
  point: string
  /** Session time (track-local seconds) the car crossed the point. */
  at: number
}

/**
 * Every timing point crossing seen in the live feed, per car. With a broadcast delay the page shows the timing from
 * a few seconds ago, but the live feed already has what happened next: the crossing at the end of the stretch each
 * car is in. Then the map doesn't need to guess the car's pace through the stretch, it knows when the car got to
 * the next point (see knownPosition).
 *
 * Measured on five 2025 F1 races against real car positions (tools/F1MapEval): 3 s of delay halves the moments the
 * dots' speed is visibly wrong (5.9 % -> 2.6 %) and cuts the error under a safety car from 26 to 17 m. In the live
 * 2026 Singapore GP (page internals sampled every frame): with a 5 s delay the next crossing was known 91 % of the
 * time, and dots moving faster than 110 m/s fell from 4.8 % of quarter-seconds (no delay) to 0.7 %.
 */
export class CrossingLog {
  private cars = new Map<string, Crossing[]>()
  private session = ''
  private now = 0

  add(update: TimingUpdate) {
    const { timing } = update
    const session = `${timing.session.meeting}|${timing.session.name}`
    // A new session, or time going backwards (a replay seeking back): the crossings we have are from later on.
    if (session !== this.session || timing.now < this.now - 1) {
      this.cars.clear()
      this.session = session
    }
    this.now = timing.now
    for (const car of timing.cars) {
      if (!car.lastPoint || !car.lastPointAt) continue
      let list = this.cars.get(car.id)
      if (!list) this.cars.set(car.id, (list = []))
      const last = list[list.length - 1]
      if (last && car.lastPointAt <= last.at) continue
      list.push({ point: car.lastPoint, at: car.lastPointAt })
      // Keep what the longest delay can still show, plus a stretch before it.
      while (list.length > 2 && list[1].at < car.lastPointAt - MAX_DELAY_SECONDS - 120) list.shift()
    }
  }

  /**
   * The crossings in a snapshot from the past: the one on screen, behind the live feed by the broadcast delay or a
   * replay's lookahead. Inserted in time order (the log already has later ones) and never clears the log. Without it
   * the log only had crossings from the live/lookahead feed, so for the first `delay` seconds after opening the page,
   * switching map views or seeking a replay, no car had a known crossing before the time shown and the map guessed.
   */
  addPast(update: TimingUpdate) {
    const { timing } = update
    if (`${timing.session.meeting}|${timing.session.name}` !== this.session) return
    for (const car of timing.cars) {
      if (!car.lastPoint || !car.lastPointAt) continue
      let list = this.cars.get(car.id)
      if (!list) this.cars.set(car.id, (list = []))
      if (list.some((c) => Math.abs(c.at - car.lastPointAt) < 1e-6)) continue
      const i = list.findIndex((c) => c.at > car.lastPointAt)
      list.splice(i < 0 ? list.length : i, 0, { point: car.lastPoint, at: car.lastPointAt })
    }
  }

  /** The car's latest crossing at or before `now` (may be newer than the delayed snapshot's: it arrived live). */
  latest(carId: string, now: number): Crossing | undefined {
    const list = this.cars.get(carId)
    if (!list) return undefined
    for (let k = list.length - 1; k >= 0; k--) if (list[k].at <= now) return list[k]
    return undefined
  }

  /** The car's first crossing after time `t` (the green flag: its first crossing of the race), if the log has it. */
  firstAfter(carId: string, t: number): Crossing | undefined {
    return this.cars.get(carId)?.find((c) => c.at > t)
  }

  /** The crossings either side of `now` for a car, if both are known. */
  around(carId: string, now: number): [Crossing, Crossing] | undefined {
    const list = this.cars.get(carId)
    if (!list || list.length < 2) return undefined
    let hi = list.length - 1
    if (list[hi].at <= now) return undefined // the next crossing hasn't happened yet: predict instead
    let lo = 0
    if (list[0].at > now) return undefined
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (list[mid].at <= now) lo = mid
      else hi = mid
    }
    return [list[lo], list[hi]]
  }
}

/**
 * Where a car was at `now`, between two crossings we know the times of: the same fraction of the simulated time
 * between the two points (corners slow, straights fast), as carPosition does with its estimate. Works across a point
 * the feed skipped. Undefined if the pair doesn't look like one stretch of normal running (a long gap, or more than
 * half a lap: pit stops, missed messages).
 */
export function knownPosition(track: TrackModel, a: Crossing, b: Crossing, now: number): number | undefined {
  const from = track.pointDistance.get(a.point)
  const to = track.pointDistance.get(b.point)
  const span = b.at - a.at
  if (from === undefined || to === undefined || a.point === b.point || span <= 0 || span > 60) return undefined
  if (track.wrap(to - from) > track.length / 2) return undefined
  return place(track, from, b.point, Math.min(Math.max((now - a.at) / span, 0), 1))
}
