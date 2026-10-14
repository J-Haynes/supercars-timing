import type { CarRow, TimingSnapshot } from '../types'
import { flagKind } from '../session'
import type { TrackModel } from './trackModel'
import type { Crossing, CrossingLog } from './crossingLog'
import { gridSlot, launchSeconds, type GridSlot } from './startGrid'

/**
 * A standing restart after a red flag: the field lines up on the grid again and starts like at the start of the race
 * (map/startGrid.ts). F1 restarts this way when conditions allow (Sporting Regulations, standing restarts since 2021;
 * race control says "STANDING START PROCEDURE" or "ROLLING START PROCEDURE"). No source was found for Supercars; the
 * one red flag in our recordings on the Supercars feed (Carrera Cup Race 2, Bathurst 2026) restarted behind the safety
 * car, which this leaves alone.
 *
 * The feeds don't say where cars are or when the lights go out. In the 2024 Monaco GP (archive; real positions):
 * red flag, cars in the pit lane, "STANDING START PROCEDURE", formation lap behind the safety car (our flag reads
 * Green from the pit exit opening, then Safety Car, then Green again 74 s before the start), each car crosses the last
 * timing point (3.4) and stops on the grid 16 m behind the line for up to 64 s, then crosses the line (laps + 1) just
 * after the lights go out: the pole car 0.1-1 s after, P16 ~5 s after. So:
 * - a car is on the grid once it has crossed the lap's last timing point after the red flag and stopped there
 *   (its next crossing is late, or hasn't come). Grid order = the order they got there (single file behind the SC).
 * - lights out = a green flag after the first car stopped (Natsoft would send one), else worked out from each car's
 *   first crossing after the stop minus its launch time (median of the front three): Monaco, within ~1 s of the real
 *   start (from the archive's car positions; known 2 s after it live without a delay, when the pole car crosses the line).
 *   Grid order there matched race control's "ORDER FOR RESTART" exactly.
 */

/** Seconds after the lights go out that cars without a crossing are still launched from the grid. */
export const RESTART_LAUNCH_SECONDS = 120

export interface RestartCar {
  /** The car's crossing of the last timing point before it stopped on the grid. */
  stop: Crossing
  place: number
  slot: GridSlot
}

export interface StandingRestart {
  /** When the lights went out, once known (a green flag, or the first crossings after the grid). */
  lightsOut?: number
  cars: Map<string, RestartCar>
}

/** 'standing' / 'rolling' from race control after `since`, else undefined (Natsoft: no known wording). */
export function restartProcedure(timing: TimingSnapshot, since: number): 'standing' | 'rolling' | undefined {
  const said = (timing.raceControl ?? []).filter((m) => m.time >= since && /\b(standing|rolling) start/i.test(m.text))
    .sort((a, b) => b.time - a.time)[0]
  return said ? (/standing start/i.test(said.text) ? 'standing' : 'rolling') : undefined
}

/**
 * The standing restart in progress at `now`, if any: cars on the grid (or driving into it) and, once known, the
 * lights out. Undefined outside one (no red flag since the start, a rolling restart, or over RESTART_LAUNCH_SECONDS
 * after the lights).
 * @param ahead the feed ahead of the time shown (live with a broadcast delay, a replay's lookahead): later flags
 * @param stretches flying-lap seconds per stretch (order[i] to the next point)
 */
export function standingRestart(
  timing: TimingSnapshot, ahead: TimingSnapshot | undefined, log: CrossingLog, model: TrackModel, order: string[],
  stretches: number[], now: number,
): StandingRestart | undefined {
  const greenAt = timing.session.greenAt ?? 0
  const flags = (ahead ?? timing).flagHistory ?? timing.flagHistory ?? []
  const red = flags.filter((f) => flagKind(f.flag) === 'red' && f.time > greenAt && f.time <= now).at(-1)?.time
  if (!greenAt || red === undefined) return undefined
  const procedure = restartProcedure(timing, red)
  if (procedure === 'rolling') return undefined

  const last = order[order.length - 1]
  // Stopped: the next crossing (the line, in front of the grid) is this long overdue. Monaco 2024: 13-64 s on the
  // grid against ~1.5 s at racing pace, 3-4 s behind the safety car. Without a "standing start" message, only a long
  // stop counts (a rolling restart's last lap behind the safety car is slow too).
  const lastStretch = stretches[order.length - 1] || 5
  const stopped = lastStretch * 4 + (procedure === 'standing' ? 2 : 10)

  const stops: { car: CarRow; stop: Crossing; next?: Crossing }[] = []
  for (const car of timing.cars) {
    if (car.inPit || car.retired) continue
    const list = log.history(car.id)
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      if (c.at <= red || c.at > now || c.point !== last) continue
      const next = list[i + 1]
      const wait = (next?.at ?? now) - c.at
      // Not stopped (yet): with a "standing start" message, a car that has just crossed is driving into its slot.
      if (wait < stopped && !(procedure === 'standing' && !next)) continue
      stops.push({ car, stop: c, next })
      break
    }
  }
  if (stops.length === 0) return undefined

  stops.sort((a, b) => a.stop.at - b.stop.at)
  const cars = new Map<string, RestartCar>()
  stops.forEach((s, i) => cars.set(s.car.id, { stop: s.stop, place: i + 1, slot: gridSlot(model, i + 1) }))

  // Lights out: a green flag once the first car has stopped, else from the first crossings after the grid.
  const first = stops[0].stop.at
  const green = flags.find((f) => f.time > first && flagKind(f.flag) === 'green')?.time
  // From the front three (median): back-row cars take longer than the estimate (Monaco: P16 +1.7 s, the median of
  // all 16 drifted from 0.1 to 1.6 s late as they arrived).
  const fromCrossings = stops.slice(0, 3).flatMap((s) => {
    const r = cars.get(s.car.id)!
    const secs = s.next ? launchSeconds(model, r.slot, order, stretches, s.next.point) : undefined
    return s.next && secs !== undefined ? [s.next.at - secs] : []
  }).sort((a, b) => a - b)
  const median = fromCrossings.length ? fromCrossings[Math.floor((fromCrossings.length - 1) / 2)] : undefined
  // A green flag much later than the crossings say isn't this start (F1 sends none at a restart's lights out).
  const lightsOut = green !== undefined && (median === undefined || green < median) ? green : median
  if (lightsOut !== undefined && now - lightsOut > RESTART_LAUNCH_SECONDS) return undefined
  return { lightsOut, cars }
}
