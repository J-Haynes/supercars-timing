import type { CarLaps, LapHistory, RaceControlMessage, TimingSnapshot } from './types'
import { cautionPeriods, flagPeriods, leaderLap, raceLaps } from './session'

/**
 * Time certain: the time of day at which a race ends even if its distance hasn't been run. Race control sends it as a
 * message; the only one seen so far (Sandown Race 33, 7 Nov 2026, 16:26, as the second safety car came out) read
 * "stewards: new time certain time for race 33 is 1753", 17:53 in track time. Natsoft's clock (`timing.now`, message
 * times) is track time already, counted as if it were UTC, so 17:53 is that day's 17:53 on the same clock.
 *
 * Matched loosely, since there's one example: "time certain", then a 4-digit time (or hh:mm) after "is". A message
 * naming another race ("for race 34") is ignored. The latest matching message wins (a "new" time replaces the old).
 */
export function timeCertainAt(sessionName: string, messages: RaceControlMessage[] | undefined): number | undefined {
  const race = /race (\d+)\b/i.exec(sessionName)?.[1]
  let found: number | undefined
  let foundAt = -Infinity
  for (const m of messages ?? []) {
    if (!/time certain/i.test(m.text) || m.time < foundAt) continue
    const named = /race (\d+)\b/i.exec(m.text)?.[1]
    if (named && race && named !== race) continue
    const t = /\bis\s+(\d{1,2}):?(\d{2})\b/i.exec(m.text)
    if (!t) continue
    const hours = Number(t[1]), minutes = Number(t[2])
    if (hours > 23 || minutes > 59) continue
    const day = Math.floor(m.time / 86400) * 86400
    found = day + hours * 3600 + minutes * 60
    foundAt = m.time
  }
  return found
}

export interface FinishOutlook {
  /** Time certain (Natsoft clock). */
  deadline: number
  /** Race distance (laps). */
  total: number
  /** Laps the leader still has to run (the lap in progress counts). */
  lapsLeft: number
  /** Green-flag lap time used (s): the leader's recent green laps. */
  pace: number
  /** Laps used for `pace`. */
  paceLaps: number
  /** When the leader would finish the distance at that pace. */
  finishAt: number
  /** Full distance before time certain at green pace. */
  full: boolean
  /** Seconds to spare (full) or short (not full) at green pace. */
  spare: number
  /** Safety-car laps the spare would cover, at the race's caution lap time (median of laps under caution, else 2x pace). */
  cautionLaps: number
  /** Not full: about how many laps the leader completes by time certain (the lap on which the clock runs out counts). */
  lapsByDeadline: number
}

/** Green-flag laps for the pace: the leader's latest ones run entirely under green, not pit laps or deleted. */
const PACE_LAPS = 10

/**
 * Whether the race is likely to run its distance before time certain, at the leader's green-flag pace. Measured data
 * only: the leader's own recent laps (lap history), laps under caution from the flag history. Undefined without a time
 * certain, a known distance, or at least three green laps; also once the race is finished.
 * `history`: lap history up to `timing.now` (a replay passes only the laps run by then).
 */
export function finishOutlook(timing: TimingSnapshot, history: LapHistory | null | undefined): FinishOutlook | undefined {
  const deadline = timeCertainAt(timing.session.name, timing.raceControl)
  const total = raceLaps(timing.session)
  if (deadline === undefined || total <= 0) return undefined
  const { finished } = leaderLap(timing)
  const leader = timing.cars.find((c) => c.position === 1) ?? timing.cars[0]
  if (finished || !leader) return undefined
  const laps = history?.cars.find((c) => c.id === leader.id)
  const cautions = cautionPeriods(timing.flagHistory)
  // Green pace leaves out laps touched by a caution or a red flag.
  const pace = greenPace(laps, [...cautions, ...flagPeriods(timing.flagHistory, 'red')], timing.now)
  if (!pace) return undefined

  const lapsLeft = Math.max(0, total - leader.laps)
  // From the leader's last crossing of the line: the lap in progress is part of what's left.
  const from = leader.lapStartAt > 0 && leader.lapStartAt <= timing.now ? leader.lapStartAt : timing.now
  const finishAt = from + lapsLeft * pace.time
  const full = finishAt <= deadline
  const cautionLap = cautionLapTime(laps, cautions, timing.now) ?? pace.time * 2
  const spare = deadline - finishAt
  return {
    deadline, total, lapsLeft, pace: pace.time, paceLaps: pace.count, finishAt, full, spare,
    cautionLaps: full ? Math.floor(spare / (cautionLap - pace.time)) : 0,
    lapsByDeadline: full ? total : Math.min(total, leader.laps + Math.max(0, Math.ceil((deadline - from) / pace.time))),
  }
}

type Period = { start: number; end?: number }
const overlaps = (start: number, end: number, p: Period) => start < (p.end ?? Infinity) && end > p.start
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function greenPace(laps: CarLaps | undefined, notGreen: Period[], now: number): { time: number; count: number } | undefined {
  const green = (laps?.laps ?? [])
    .filter((l) => l.time > 0 && !l.pitted && !l.deleted && l.at <= now && !notGreen.some((p) => overlaps(l.at - l.time, l.at, p)))
    .slice(-PACE_LAPS)
    .map((l) => l.time)
  return green.length >= 3 ? { time: median(green), count: green.length } : undefined
}

/** Median lap time of the leader's laps run entirely under caution this race (the safety car's pace). */
function cautionLapTime(laps: CarLaps | undefined, cautions: Period[], now: number): number | undefined {
  const under = (laps?.laps ?? [])
    .filter((l) => l.time > 0 && !l.pitted && l.at <= now && cautions.some((p) => l.at - l.time >= p.start && l.at <= (p.end ?? Infinity)))
    .map((l) => l.time)
  return under.length > 0 ? median(under) : undefined
}
