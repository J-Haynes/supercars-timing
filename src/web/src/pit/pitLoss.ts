import type { TimingSnapshot } from '../types'
import { flagKind } from '../session'
import { isF1 } from '../series'

/**
 * What a pit stop costs: the seconds a car loses to the cars that stay out (in-lap + out-lap minus two normal laps).
 * EXPERIMENTAL ESTIMATE, shown as a range: Supercars' stops are mostly refuelling, a team's own plan we can't see.
 *
 * Where the numbers come from (docs/PLANNING.md, "Pit strategy features", has the method and the measurements):
 *  1. Stops already made in this race, from each stop's pit-lane time. Supercars: Natsoft's PT minus 2.7 s matched
 *     the lap-time loss of 155 green-flag stops at the Bathurst 1000 (half within 1.4-3.6 s). F1: our in-pit time
 *     minus the circuit's (pit lane - loss) difference from last year's archive.
 *  2. Last year's races at this track (PRIORS below; Supercars by stop number: the second stop takes more fuel and
 *     cost 10-15 s more at all three Finals tracks), moved by how far this race's stops differ from them so far.
 *  3. Neither: a wide range, marked as such.
 */

/** [lower quartile, median, upper quartile] in seconds: the middle half of the stops measured. */
export type LossRange = [number, number, number]

interface Prior {
  /** By stop number: [0] = first stop. Later stops use the last entry. */
  byStop: LossRange[]
  /** Short races at the same track (Adelaide's 32-lap Race 35): fewer laps than `maxLaps`. */
  short?: { maxLaps: number; byStop: LossRange[]; source: string }
  /** F1: our in-pit time minus this = time lost (last year's pit-lane time minus loss). */
  laneOffset?: number
  source: string
}

/** Supercars: Natsoft results-site reports (tools/PitLoss/natsoft_report.py) and our Bathurst recording. */
const NATSOFT_2025 = 'Natsoft results, 2025'
const PRIORS: Record<string, Prior> = {
  MOUN: {
    byStop: [[61.4, 64.0, 66.8], [63.4, 66.7, 68.1], [62.0, 66.4, 68.1], [66.0, 67.8, 68.8], [59.7, 67.0, 68.6], [54.3, 61.3, 68.3]],
    source: 'Bathurst 1000 Race 30, 2026 (our recording, 155 stops)',
  },
  SURF: { byStop: [[37.7, 38.8, 44.8], [46.6, 50.2, 54.9]], source: `Gold Coast Races 28-29 (${NATSOFT_2025}, 57 stops)` },
  SAND: { byStop: [[36.5, 37.7, 39.8], [46.1, 48.2, 49.1]], source: `Sandown Races 30-31 (${NATSOFT_2025}, 46 stops)` },
  ADEL: {
    byStop: [[27.3, 28.6, 31.1], [42.1, 43.8, 45.1]],
    short: { maxLaps: 40, byStop: [[24.1, 25.8, 27.4]], source: `Adelaide Race 32, 32 laps (${NATSOFT_2025}, 9 stops)` },
    source: `Adelaide Races 33-34 (${NATSOFT_2025}, 86 stops)`,
  },
  // F1: 2025 races from F1's archive (tools/PitLoss/f1_archive.py). One range: stops are ~2.5-3 s tyre changes.
  'F1-61': { byStop: [[21.5, 22.9, 24.6]], laneOffset: 1.1, source: 'Singapore GP 2025 (F1 archive, 19 stops)' },
  'F1-9': { byStop: [[19.8, 20.7, 22.1]], laneOffset: 3.3, source: 'United States GP 2025 (F1 archive, 21 stops)' },
  'F1-65': { byStop: [[20.6, 22.2, 23.2]], laneOffset: 0.4, source: 'Mexico City GP 2025 (F1 archive, 21 stops)' },
  'F1-14': { byStop: [[20.8, 21.7, 23.1]], laneOffset: 1.8, source: 'São Paulo GP 2025 (F1 archive, 28 stops)' },
  'F1-152': { byStop: [[21.0, 22.1, 24.1]], laneOffset: -0.6, source: 'Las Vegas GP 2025 (F1 archive, 12 stops)' },
  'F1-150': { byStop: [[24.7, 25.2, 26.1]], laneOffset: 3.7, source: 'Qatar GP 2025 (F1 archive, 20 stops)' },
  'F1-70': { byStop: [[21.4, 22.7, 23.5]], laneOffset: -0.8, source: 'Abu Dhabi GP 2025 (F1 archive, 24 stops)' },
}

/** No data for this track at all: wide, and said so. */
const UNKNOWN: Record<'supercars' | 'f1', LossRange> = { supercars: [30, 45, 65], f1: [19, 22, 26] }

/** Supercars: time lost = Natsoft's pit-lane time (PT) minus this (measured at Bathurst, see above). */
const SUPERCARS_PT_OFFSET = 2.7
/** Stops longer than this in the pit lane were repairs, not pit stops. */
const MAX_STOP_SECONDS = 200
/** A range from this race needs this many stops of the same number (3, 5 and 8 backtested the same; 5 avoids wide
 * ranges from the first few stops). */
const MIN_LIVE_STOPS = 5

export interface LossEstimate {
  range: LossRange
  /** Which stop this would be (1 = first). */
  stopNumber: number
  /** Where the range came from, for the panel. */
  source: string
  /** 'race': this race's stops; 'prior': last year's (maybe moved by this race's); 'none': no data, wide range. */
  basis: 'race' | 'prior' | 'none'
}

/** A green-flag stop made in this race: its stop number (1-based) and the time it cost. */
export interface MeasuredStop { stopNumber: number; lost: number }

/** Seconds to take off a stop's pit-lane time to get the time it cost (see the module comment). */
export function pitLaneOffset(trackCode: string): number {
  return isF1 ? PRIORS[trackCode]?.laneOffset ?? 1 : SUPERCARS_PT_OFFSET
}

/** Green-flag stops completed before `now` in this race, with what each cost (see the module comment). */
export function measuredStops(timing: TimingSnapshot, trackCode: string, now = timing.now): MeasuredStop[] {
  const offset = pitLaneOffset(trackCode)
  const history = timing.flagHistory ?? []
  const greenAt = (t: number) => {
    let flag = 'Green'
    for (const f of history) if (f.time <= t) flag = f.flag
    return flagKind(flag) === 'green'
  }
  const out: MeasuredStop[] = []
  for (const car of timing.cars) {
    car.pitLog.forEach((stop, i) => {
      if (stop.outAt <= 0 || stop.outAt > now || stop.seconds <= 0 || stop.seconds > MAX_STOP_SECONDS) return
      if (!greenAt(stop.inAt) || !greenAt(stop.outAt)) return
      out.push({ stopNumber: i + 1, lost: stop.seconds - offset })
    })
  }
  return out
}

/**
 * The likely cost of `stopNumber` (1-based) for a car at `trackCode` now. `raceLaps` picks Adelaide's short-race
 * figures. See the module comment for the order the sources are tried in.
 */
export function estimateLoss(stopNumber: number, trackCode: string, measured: MeasuredStop[], raceLaps: number): LossEstimate {
  const prior = PRIORS[trackCode]
  const useShort = prior?.short && raceLaps > 0 && raceLaps <= prior.short.maxLaps
  const priorStops = useShort ? prior!.short!.byStop : prior?.byStop
  const priorSource = useShort ? prior!.short!.source : prior?.source
  // F1 stops are all alike (tyres only): every stop counts as "stop 1".
  const number = isF1 ? 1 : stopNumber
  const sameNumber = measured.filter((s) => (isF1 ? 1 : s.stopNumber) === number).map((s) => s.lost)
  if (sameNumber.length >= MIN_LIVE_STOPS) {
    return { range: widen(quartiles(sameNumber)), stopNumber, basis: 'race', source: `this race (${sameNumber.length} green-flag stops)` }
  }
  const priorFor = (n: number) => priorStops?.[Math.min(n, priorStops.length) - 1]
  const base = priorFor(number)
  if (base) {
    // Move last year's figures by how far this race's stops differ from them (median of the differences, by stop
    // number), once there are enough to tell. A changed fuel rule or pit-lane limit shows up here.
    const shifts: number[] = []
    for (const n of new Set(measured.map((s) => (isF1 ? 1 : s.stopNumber)))) {
      const live = measured.filter((s) => (isF1 ? 1 : s.stopNumber) === n).map((s) => s.lost)
      const p = priorFor(n)
      if (live.length >= MIN_LIVE_STOPS && p) shifts.push(median(live) - p[1])
    }
    const shift = shifts.length ? median(shifts) : 0
    const range = base.map((v) => round1(v + shift)) as LossRange
    const note = shifts.length ? `, moved ${shift >= 0 ? '+' : ''}${shift.toFixed(1)} s to match this race` : ''
    return { range, stopNumber, basis: 'prior', source: `${priorSource}${note}` }
  }
  const any = measured.map((s) => s.lost)
  if (any.length >= MIN_LIVE_STOPS) return { range: widen(quartiles(any)), stopNumber, basis: 'race', source: `this race (${any.length} stops, any stop number)` }
  return { range: UNKNOWN[isF1 ? 'f1' : 'supercars'], stopNumber, basis: 'none', source: 'no data for this track yet: a wide guess' }
}

/** At least ±3 s around the median: then the real stop falls inside about half the time, as a middle half should
 * (Bathurst backtest: ±1.5 s caught 38%, ±3.5 s 52%; tools/PitLoss/backtest.mts). */
function widen([lo, mid, hi]: LossRange): LossRange {
  return [round1(Math.min(lo, mid - 3)), round1(mid), round1(Math.max(hi, mid + 3))]
}

function quartiles(values: number[]): LossRange {
  const v = [...values].sort((a, b) => a - b)
  const at = (q: number) => {
    const i = (v.length - 1) * q
    const lo = Math.floor(i)
    return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo)
  }
  return [at(0.25), at(0.5), at(0.75)]
}

function median(values: number[]): number {
  return quartiles(values)[1]
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
