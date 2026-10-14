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
 * - The Gold Coast field and its starting points (checked 14 Oct 2026): Supercars' "Standings for 2026 Boost Mobile
 *   Gold Coast 500", https://www.supercars.com/news/supercars-news-2026-finals-drivers-field-bathurst-1000-qualified-set-payne-feeney-kostecki-brown
 *   Payne 3150, Feeney (Sprint Cup) 3145, Brown (Enduro Cup) 3103, Kostecki 3096, Allen 3066, Waters 3057,
 *   De Pasquale 3048, Mostert 3039, Wood 3030, Le Brocq 3021. That is 3000 + 150/120/96/78 for the top four after
 *   Bathurst and +25 per cup, as above, plus 66/57/48/39/30/21 for 5th-10th, which the rules articles don't mention
 *   (they only name the top four's). Our own sum from the recorded Bathurst result put Allen 4th and Brown 5th, so
 *   the round uses the official numbers (`field`). Car numbers from STANDINGS_AFTER_R10.
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
  /** The official field going into the round, in seed order (1 = top after the previous round), with each driver's
   * starting points. When set it replaces our own sum from the recorded results. */
  field?: { car: string; start: number }[]
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
    // Sprint Cup: Broc Feeney; Enduro Cup (The Bend + Bathurst): Will Brown (Supercars' Finals field, above).
    cupWinners: { sprint: '88', enduro: '888' },
    cupBonus: 25,
    field: [
      { car: '19', start: 3150 }, { car: '88', start: 3145 }, { car: '17', start: 3096 }, { car: '888', start: 3103 },
      { car: '26', start: 3066 }, { car: '6', start: 3057 }, { car: '18', start: 3048 }, { car: '1', start: 3039 },
      { car: '2', start: 3030 }, { car: '4', start: 3021 },
    ],
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

  // Finalists: the official field when we have it, else the cup winners and then the rest of the top of the table.
  const winners = [round.cupWinners.sprint, round.cupWinners.enduro].filter((c): c is string => !!c)
  const official = round.field?.map((f) => ordinary.find((d) => d.car === f.car) ?? { car: f.car, driver: STANDINGS_AFTER_R10[f.car]?.[0] ?? `#${f.car}`, points: 0 })
  const finalists = official ?? [...ordinary.filter((d) => winners.includes(d.car)), ...ordinary.filter((d) => !winners.includes(d.car))]
    .slice(0, round.finalists)
  const seedOf = (car: string) => (round.field ? round.field.findIndex((f) => f.car === car) : ordinary.findIndex((d) => d.car === car)) + 1
  const startOf = (car: string) => round.field?.find((f) => f.car === car)?.start
    ?? round.reset + (round.bonus[seedOf(car) - 1] ?? 0) + (winners.includes(car) ? round.cupBonus : 0)

  const earlier = earlierRaces.map((r) => scored(r, round.points))
  const live = scored(projectedFinish(timing).map((c) => c.carNumber), round.points)
  const carId = (n: string) => timing.cars.find((c) => c.carNumber === n)?.id

  const rows: FinalsRow[] = finalists.map((d) => {
    const seed = seedOf(d.car)
    const start = startOf(d.car)
    const banked = earlier.reduce((s, r) => s + (r.get(d.car) ?? 0), 0)
    const today = live.get(d.car) ?? 0
    return { carNumber: d.car, carId: carId(d.car), driver: d.driver, seed, start, banked, today, total: start + banked + today, rank: 0 }
  })
  rows.sort((a, b) => b.total - a.total || a.seed - b.seed).forEach((r, i) => { r.rank = i + 1 })

  // Everyone else keeps ordinary points (the fight for 5th and below stays open from 2026).
  const others: OtherRow[] = ordinary.filter((d) => !finalists.some((f) => f.car === d.car)).map((d) => {
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

/** Recorded Supercars race sessions of a meeting this season, oldest first (last year's rebuilt Gold Coast races
 * matched /gold coast/ too, and would have counted as races already run at this year's round). */
export function racesOf(sessions: RecordedSession[], meeting: RegExp): RecordedSession[] {
  return sessions.filter((s) => meeting.test(s.meeting) && inPointsSeason(s.meeting) && /race/i.test(s.type) && /supercars championship - race \d+$/i.test(s.name))
    .sort((a, b) => a.start.localeCompare(b.start))
}
