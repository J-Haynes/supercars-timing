import type { RecordedSession, TimingSnapshot } from './types'
import { STANDINGS_AFTER_BATHURST, inPointsSeason } from './championship'
import { flagKind } from './session'

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
 * - Win and you're in (checked 25 Oct 2026): "Any of the 10 finalists who wins either Gold Coast race is automatically
 *   through to Sandown", the same at Sandown for the Grand Final; "the three worst-placed drivers on points (8th, 9th,
 *   10th) will be eliminated" unless "they win either race on Saturday or Sunday, in which case the next worst-placed
 *   driver will be eliminated"; a non-finalist's win earns no place. Eliminated drivers "revert to the championship
 *   points they held after Bathurst, plus points scored in subsequent races".
 *   https://autoaction.com.au/2026/10/21/supercars-finals-2026-explained-format-points ,
 *   https://speedcafe.com/supercars-news-2026-finals-series-explained-guide-points-permuations-gold-coast-sandown-adelaide-grand-final/
 *   Supercars' own table after Race 31 matches start + race points exactly (Payne 3277, Mostert "advanced" on 3189).
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

/**
 * Car numbers of the drivers still in the Finals at this meeting: the round's official field (`field`). Empty outside a
 * Finals round, or for a round whose field isn't entered yet (Sandown and Adelaide until their entries are added).
 */
export function finalistCars(meeting: string): Set<string> {
  return new Set(finalsRoundFor(meeting)?.field?.map((f) => f.car) ?? [])
}

/** Points by car number from a finishing order (car numbers, 1st first). */
function scored(order: string[], scale: number[]): Map<string, number> {
  return new Map(order.map((car, i) => [car, scale[i] ?? 0]))
}

export interface StandingRow {
  /** Car number at this round (undefined: a co-driver or wildcard with points but no car here). */
  carNumber?: string
  carId?: string
  driver: string
  finalist: boolean
  /** Seed going into the Finals (1-10), finalists only. */
  seed?: number
  /** Sprint/Enduro Cup winner (finalists' 25-point bonus). */
  cup?: string
  /** Points now: Finals starting points (finalists) or points after Bathurst, plus races already run at the round. */
  points: number
  /** Provisional points for the race on now, if it finished now (0 outside a race). */
  live: number
  /** Projected finishing position in the race on now (0 = not running / no race). */
  finish: number
  total: number
  /** Position in the standings now, and with the provisional points. */
  rankNow: number
  rank: number
  /** Races won at this round (finalists: win and you're in). */
  wins: number
  /** Leading the race on now: through if it finished now. */
  leading: boolean
  /** Finalists: eliminated if the round ended now (the lowest on points among those without a win here). */
  out: boolean
}

/**
 * Championship standings at a Finals round: the finalists on their Finals points, then everyone else on ordinary
 * points (eliminated and non-finalist drivers race on for 11th and below), each plus the points from races already
 * run at the round. With `live` (a finishing order, car numbers, while a race of the round is on) each driver also
 * gets that race's points for where they are now: provisional, shown apart from what's earned. Undefined for a round
 * without its official field (finals.ts `field`).
 */
export function roundStandings(round: FinalsRound, earlierRaces: string[][], live?: string[]) {
  const field = round.field
  if (!field) return undefined
  const earned = (car?: string) => (car ? earlierRaces.reduce((s, r) => s + (scored(r, round.points).get(car) ?? 0), 0) : 0)
  const today = live ? scored(live, round.points) : new Map<string, number>()
  const finishOf = (car?: string) => (car && live ? live.indexOf(car) + 1 : 0)
  const winsOf = (car?: string) => (car ? earlierRaces.filter((r) => r[0] === car).length : 0)
  const cupOf = (car: string) => [car === round.cupWinners.sprint && 'Sprint Cup', car === round.cupWinners.enduro && 'Enduro Cup'].filter(Boolean).join(', ') || undefined

  const finalists: StandingRow[] = field.map((f, i) => {
    const driver = STANDINGS_AFTER_BATHURST.find((d) => d.car === f.car)?.driver ?? `Car ${f.car}`
    const points = f.start + earned(f.car)
    const l = today.get(f.car) ?? 0
    return { carNumber: f.car, driver, finalist: true, seed: i + 1, cup: cupOf(f.car), points, live: l, finish: finishOf(f.car), total: points + l, rankNow: 0, rank: 0, wins: winsOf(f.car), leading: finishOf(f.car) === 1, out: false }
  })
  const rest: StandingRow[] = STANDINGS_AFTER_BATHURST.filter((d) => !field.some((f) => f.car === d.car)).map((d) => {
    const points = d.points + earned(d.car)
    const l = (d.car && today.get(d.car)) || 0
    return { carNumber: d.car, driver: d.driver, finalist: false, points, live: l, finish: finishOf(d.car), total: points + l, rankNow: 0, rank: 0, wins: winsOf(d.car), leading: finishOf(d.car) === 1, out: false }
  })
  // Finalists always rank above everyone else (Finals points start at 3000, ordinary points end below 2500 here, but
  // rank them as groups anyway).
  const rankBy = (key: 'points' | 'total', set: 'rankNow' | 'rank') => {
    const tie = (a: StandingRow, b: StandingRow) => (a.seed ?? 99) - (b.seed ?? 99)
    const group = (rows: StandingRow[]) => [...rows].sort((a, b) => b[key] - a[key] || tie(a, b))
    ;[...group(finalists), ...group(rest)].forEach((r, i) => { r[set] = i + 1 })
  }
  rankBy('points', 'rankNow')
  rankBy('total', 'rank')
  const rows = [...finalists, ...rest].sort((a, b) => a.rank - b.rank)
  // Win and you're in: the eliminated are the lowest on points (with this race as it stands) among finalists who
  // haven't won here, or aren't leading the race on now.
  const contenders = rows.filter((r) => r.finalist && r.wins === 0 && !r.leading)
  contenders.slice(Math.max(0, contenders.length - round.eliminate)).forEach((r) => { r.out = true })
  return { rows, advance: round.finalists - round.eliminate }
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

/**
 * The races that finished (flag chequered or ended, laps run), one per race: a race whose recording was split by a
 * restart is several sessions with the same name, of which only the last has the result. Oldest first.
 */
export function finishedRaces<T extends { session: RecordedSession; results: TimingSnapshot }>(races: T[]): T[] {
  const done = races.filter((r) => flagKind(r.results.session.flag) === 'finished' && r.results.cars.some((c) => c.position > 0 && c.laps > 0))
  const latest = new Map<string, T>()
  for (const r of done) {
    const seen = latest.get(r.session.name)
    if (!seen || r.session.start > seen.session.start) latest.set(r.session.name, r)
  }
  return [...latest.values()].sort((a, b) => a.session.start.localeCompare(b.session.start))
}
