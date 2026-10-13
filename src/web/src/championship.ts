import type { CarRow, SessionInfo, TimingSnapshot } from './types'
import { liveGap, raceOrder, raceFinished } from './liveGaps'
import { unservedSeconds } from './penalties'

/**
 * Championship data that isn't in the timing feed: standings coming into a race and its points scale.
 * Keyed by car number (stable, and avoids "Matt"/"Matthew" name differences with Natsoft).
 *
 * Bathurst 1000, 2026: standings after Round 10 from V8 Sleuth
 * (https://www.v8sleuth.com.au/the-supercars-finals-situation-heading-into-bathurst-1000/), full-time drivers only
 * (Lowndes #15 and Moffat #34 are part-timers). Enduro points scale from the 2026 season page on Wikipedia
 * (https://en.wikipedia.org/wiki/2026_Supercars_Championship); it lists 25 places, so 26th scores 0 here.
 * Not included: Enduro Cup bonus points (not published in those sources).
 */
interface RaceChampionship {
  meeting: RegExp
  session: RegExp
  /** Car number -> [full-time driver, points before this race]. */
  standings: Record<string, [string, number]>
  /** Points by finishing position, 1st first. */
  points: number[]
  /** This many at the top of the ladder after the race go to the Finals. */
  finalsCut: number
}

export const ENDURO_POINTS = [300, 276, 258, 240, 222, 204, 192, 180, 168, 156, 144, 138, 132, 126, 120, 114, 108, 102, 96, 90, 84, 78, 72, 66, 60]

/** Drivers' standings after Round 10 (car number -> [driver, points]); see the sources in the comment above. */
export const STANDINGS_AFTER_R10: Record<string, [string, number]> = {
  '19': ['Matt Payne', 2275], '88': ['Broc Feeney', 2155], '26': ['Kai Allen', 2069], '17': ['Brodie Kostecki', 1971],
  '6': ['Cam Waters', 1962], '18': ['Anton De Pasquale', 1879], '888': ['Will Brown', 1870], '1': ['Chaz Mostert', 1713],
  '2': ['Ryan Wood', 1594], '4': ['Jack Le Brocq', 1313], '8': ['André Heimgartner', 1251], '55': ['Thomas Randle', 1250],
  '31': ['Jayden Ojeda', 1243], '7': ['James Golding', 1226], '48': ['David Reynolds', 1035], '14': ['Cameron Hill', 944],
  '38': ['Rylan Gray', 916], '10': ['Zach Bates', 815], '99': ['Cooper Murray', 774], '3': ['Aaron Cameron', 763],
  '777': ['Declan Fraser', 715], '96': ['Macauley Jones', 710], '11': ['Jackson Walls', 663], '9': ['Jobe Stewart', 639],
}

const RACES: RaceChampionship[] = [
  {
    meeting: /bathurst 1000/i,
    session: /supercars championship - race 30$/i,
    points: ENDURO_POINTS,
    finalsCut: 10,
    standings: STANDINGS_AFTER_R10,
  },
]

export interface LadderRow {
  carNumber: string
  carId?: string
  driver: string
  before: number
  /** Points for the car's projected finishing position today. */
  today: number
  total: number
  /** Projected finishing position today (0 = not running). */
  finish: number
  rank: number
  rankBefore: number
}

/** The season the points data here and in finals.ts is for. */
export const POINTS_SEASON = 2026

/** False for a meeting from another season ("2025 Boost Mobile Gold Coast 500", a rebuilt past race): this season's
 * standings and Finals rules don't apply to it. Meetings without a year count as this season. */
export function inPointsSeason(meeting: string): boolean {
  const year = meeting.match(/^(\d{4})\s/)?.[1]
  return !year || Number(year) === POINTS_SEASON
}

export function championshipFor(session: SessionInfo): RaceChampionship | undefined {
  if (!inPointsSeason(session.meeting)) return undefined
  return RACES.find((r) => r.meeting.test(session.meeting) && r.session.test(session.name))
}


/**
 * Finishing order if the race ended now: the road order, with time penalties not yet served added to the gap of
 * cars on the lead lap (an unserved +5 s puts a car behind anyone within 5 s). Lapped cars keep their order behind.
 */
export function projectedFinish(timing: TimingSnapshot): CarRow[] {
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const cars = raceOrder(timing)
  const leader = cars[0]
  if (!leader) return []
  if (raceFinished(timing)) return cars
  const lead = cars.filter((c) => c.gapLaps === 0)
  const lapped = cars.filter((c) => c.gapLaps > 0)
  const gap = (c: CarRow) => (c === leader ? 0 : liveGap(c, leader, order) ?? (c.liveGapLaps === 0 && c.liveGap > 0 ? c.liveGap : c.gap))
  const adjusted = lead.map((c, i) => ({ c, t: gap(c) + unservedSeconds(c, timing), i })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.c)
  return [...adjusted, ...lapped]
}

/** The championship ladder with today's projected points added. Undefined when we have no standings for the race. */
export function liveLadder(timing: TimingSnapshot): { rows: LadderRow[]; finalsCut: number } | undefined {
  const champ = championshipFor(timing.session)
  if (!champ) return undefined
  const finish = projectedFinish(timing)
  const before = Object.entries(champ.standings).sort((a, b) => b[1][1] - a[1][1])
  const rows = before.map(([carNumber, [driver, points]], i) => {
    const place = finish.findIndex((c) => c.carNumber === carNumber) + 1
    const today = place > 0 ? champ.points[place - 1] ?? 0 : 0
    const car = timing.cars.find((c) => c.carNumber === carNumber)
    return { carNumber, carId: car?.id, driver, before: points, today, total: points + today, finish: place, rank: 0, rankBefore: i + 1 }
  })
  rows.sort((a, b) => b.total - a.total || a.rankBefore - b.rankBefore).forEach((r, i) => { r.rank = i + 1 })
  return { rows, finalsCut: champ.finalsCut }
}
