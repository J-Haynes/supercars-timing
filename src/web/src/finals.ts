import type { RecordedSession, TimingSnapshot } from './types'
import { ENDURO_POINTS, STANDINGS_AFTER_R10, inPointsSeason, projectedFinish } from './championship'

/**
 * Finals rounds (2026): the top 10 after Bathurst go to the Finals. At each Finals round their points reset and
 * a bonus is added by championship position going in; after the round the bottom three are eliminated.
 *
 * Sources (checked 11 Oct 2026):
 * - Race points for Rounds 12-13 (Gold Coast 500, Sandown 500), all races, and the Enduro scale: 2026 season page,
 *   https://en.wikipedia.org/wiki/2026_Supercars_Championship
 * - Bonus 150/120/96/78 for the top four at every Finals round, three eliminated per round, eliminated drivers revert
 *   to ordinary points: https://adelaidegrandfinal.com.au/latest-news/2026-finals-rule-changes-explained/ and
 *   https://www.v8sleuth.com.au/supercars-finalises-2026-tweaks-to-playoffs-points/
 * - Sprint Cup and Enduro Cup winners: automatic entry and 25 bonus points into the Finals:
 *   https://speedcafe.com/supercars-news-adelaide-grand-final-championship-rules-points-changes-2026-explained/
 * - Reset to 3000 at the Gold Coast (4000 Sandown, 5000 Adelaide, "5150, 5120, 5096 and 5078" for the grand
 *   finalists): reported for 2025 and said to be unchanged in principle for 2026. Not confirmed in 2026 wording.
 */
export interface FinalsRound {
  meeting: RegExp
  /** Points each finalist starts the round on, before bonuses. */
  reset: number
  /** Bonus by championship position going into the round (1st, 2nd, ...). */
  bonus: number[]
  /** Points per race by finishing position. */
  points: number[]
  /** Finalists going into this round, and how many are eliminated after it. */
  finalists: number
  eliminate: number
  /** Car numbers of the Sprint Cup and Enduro Cup winners: automatic entry plus `cupBonus` points. */
  cupWinners: { sprint?: string; enduro?: string }
  cupBonus: number
}

const FINALS_POINTS = [150, 138, 127, 117, 107, 99, 91, 84, 77, 71, 65, 60, 55, 51, 47, 43, 40, 36, 33, 31, 28, 26, 24, 22, 20]

export const FINALS_ROUNDS: FinalsRound[] = [
  {
    meeting: /gold coast/i,
    reset: 3000,
    bonus: [150, 120, 96, 78],
    points: FINALS_POINTS,
    finalists: 10,
    eliminate: 3,
    // Sprint Cup: Broc Feeney (2026 season page). Enduro Cup (The Bend + Bathurst): fill in after the Bathurst 1000.
    cupWinners: { sprint: '88', enduro: undefined },
    cupBonus: 25,
  },
]

export function finalsRoundFor(meeting: string): FinalsRound | undefined {
  // This season's Finals only: last year's Gold Coast (a rebuilt past race) matched too.
  if (!inPointsSeason(meeting)) return undefined
  return FINALS_ROUNDS.find((r) => r.meeting.test(meeting))
}

/** Points by car number from a finishing order (car numbers, 1st first). */
function scored(order: string[], scale: number[]): Map<string, number> {
  return new Map(order.map((car, i) => [car, scale[i] ?? 0]))
}

export interface FinalsRow {
  carNumber: string
  carId?: string
  driver: string
  seed: number
  start: number
  banked: number
  today: number
  total: number
  rank: number
}

export interface OtherRow {
  carNumber: string
  carId?: string
  driver: string
  total: number
  today: number
}

/**
 * The live Finals ladder for a round.
 * @param bathurstOrder official finishing order of the Bathurst 1000 (car numbers), to get standings after it
 * @param earlierRaces finishing orders of races already completed at this round (car numbers)
 */
export function finalsLadder(timing: TimingSnapshot, round: FinalsRound, bathurstOrder: string[], earlierRaces: string[][]) {
  const bathurst = scored(bathurstOrder, ENDURO_POINTS)
  const ordinary = Object.entries(STANDINGS_AFTER_R10)
    .map(([car, [driver, points]]) => ({ car, driver, points: points + (bathurst.get(car) ?? 0) }))
    .sort((a, b) => b.points - a.points)

  // Finalists: the cup winners, then the rest of the top of the table, up to the field size.
  const winners = [round.cupWinners.sprint, round.cupWinners.enduro].filter((c): c is string => !!c)
  const finalists = [...ordinary.filter((d) => winners.includes(d.car)), ...ordinary.filter((d) => !winners.includes(d.car))]
    .slice(0, round.finalists)
  const seedOf = (car: string) => ordinary.findIndex((d) => d.car === car) + 1

  const earlier = earlierRaces.map((r) => scored(r, round.points))
  const live = scored(projectedFinish(timing).map((c) => c.carNumber), round.points)
  const carId = (n: string) => timing.cars.find((c) => c.carNumber === n)?.id

  const rows: FinalsRow[] = finalists.map((d) => {
    const seed = seedOf(d.car)
    const start = round.reset + (round.bonus[seed - 1] ?? 0) + (winners.includes(d.car) ? round.cupBonus : 0)
    const banked = earlier.reduce((s, r) => s + (r.get(d.car) ?? 0), 0)
    const today = live.get(d.car) ?? 0
    return { carNumber: d.car, carId: carId(d.car), driver: d.driver, seed, start, banked, today, total: start + banked + today, rank: 0 }
  })
  rows.sort((a, b) => b.total - a.total || a.seed - b.seed).forEach((r, i) => { r.rank = i + 1 })

  // Everyone else keeps ordinary points (the fight for 5th and below stays open from 2026).
  const others: OtherRow[] = ordinary.filter((d) => !finalists.includes(d)).map((d) => {
    const banked = earlier.reduce((s, r) => s + (r.get(d.car) ?? 0), 0)
    const today = live.get(d.car) ?? 0
    return { carNumber: d.car, carId: carId(d.car), driver: d.driver, today, total: d.points + banked + today }
  }).sort((a, b) => b.total - a.total)

  return { rows, others, advance: round.finalists - round.eliminate }
}

/** Finishing order (car numbers) from a recorded session's results (GET /api/sessions/{id}/results). */
export function resultOrder(results: TimingSnapshot): string[] {
  return [...results.cars].filter((c) => c.position > 0).sort((a, b) => a.position - b.position).map((c) => c.carNumber)
}

/** Recorded Supercars race sessions of a meeting, oldest first. */
export function racesOf(sessions: RecordedSession[], meeting: RegExp): RecordedSession[] {
  return sessions.filter((s) => meeting.test(s.meeting) && /race/i.test(s.type) && /supercars championship - race \d+$/i.test(s.name))
    .sort((a, b) => a.start.localeCompare(b.start))
}
