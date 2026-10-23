import type { CarRow, SessionInfo } from './types'

/** Practice, qualifying and shootouts are ranked by best lap; races by running order. */
export function isRace(sessionType: string): boolean {
  return sessionType.toLowerCase().includes('race')
}

/** Top Ten Shootout (or similar single-car runs), detected from Natsoft's session name/type. */
export function isShootout(sessionName: string, sessionType: string): boolean {
  return /shoot\s*-?out|top\s*(10|ten)/i.test(`${sessionName} ${sessionType}`)
}

/**
 * Qualifying (not the Shootout): Natsoft's session name says so ("Qualifying (Race 31)" in the 2026 timetable; the
 * session type Natsoft sends for qualifying hasn't been seen yet, docs/PROTOCOL.md), F1's type is "Qualifying".
 */
export function isQualifying(sessionName: string, sessionType: string): boolean {
  return !isRace(sessionType) && !isShootout(sessionName, sessionType) && /qualif/i.test(`${sessionName} ${sessionType}`)
}

/**
 * Cars that have taken the chequered flag in practice, qualifying or a Shootout. Neither feed says so per car
 * (Natsoft has no field for it that we know of, docs/PROTOCOL.md), so it's worked out:
 * - once the session's flag is chequered, a car has finished when it crosses the line after the flag came out
 *   (`lastLineAt`, which stays put when the car pits afterwards; the flag's time is from the flag history);
 * - in a Shootout each car runs on its own and its run ends at the line after its one flying lap, so a car with a
 *   lap time has finished (the on-track card counts "completed" runs the same way).
 * The marks go when the flag changes again (F1 qualifying: the next part starts). Races have their own finish
 * (raceFinished in liveGaps.ts), so none here.
 */
export function finishedCars(timing: { session: SessionInfo; cars: CarRow[]; flagHistory?: { time: number; flag: string }[] }): Set<string> {
  const { session, cars } = timing
  if (isRace(session.type)) return new Set()
  const done = new Set<string>()
  if (isShootout(session.name, session.type)) cars.filter((c) => c.bestLap > 0).forEach((c) => done.add(c.id))
  if (flagKind(session.flag) === 'finished') {
    // Chequered then Ended is one period: the start of the current one is when the flag came out.
    const period = flagPeriods(timing.flagHistory, 'finished').at(-1)
    if (period && period.end === undefined) cars.filter((c) => (c.lastLineAt ?? 0) >= period.start).forEach((c) => done.add(c.id))
  }
  return done
}

/** Race distances Natsoft doesn't send (it sends <E L> = 0 for most races). `race` narrows it to one race by name. */
const KNOWN_RACE_LAPS: { meeting: RegExp; race?: RegExp; laps: number }[] = [
  { meeting: /bathurst 1000/i, laps: 161 },
  // Both Gold Coast races: "85 laps or 1 lap after" a time limit (Supercars schedule, 16 Sep 2026).
  { meeting: /gold coast/i, laps: 85 },
  // Sandown, two 250 km races: "500 km race distance and 81 laps" (https://travel.supercars.com/2026-sandown); 81-lap
  // races in 2025 too. Supercars hadn't published the 2026 track schedule yet (12 Oct 2026): check it when it is.
  { meeting: /sandown/i, laps: 81 },
  // Adelaide: Race 35 (Friday, 100 km) 32 laps, Races 36 and 37 (250 km) 78 laps. Supercars track schedule, "correct as
  // of Wednesday July 1": https://www.supercars.com/news/supercars-news-2026-adelaide-grand-final-track-schedule-revealed-times-racing-super2-series-finals-supports
  { meeting: /adelaide/i, race: /race 35\b/i, laps: 32 },
  { meeting: /adelaide/i, race: /race 3[67]\b/i, laps: 78 },
]

/** Scheduled laps for a race: Natsoft's value if it sends one, else a known distance; 0 = unknown (e.g. timed). */
export function raceLaps(session: SessionInfo): number {
  if (!isRace(session.type)) return 0
  if (session.scheduledLaps > 0) return session.scheduledLaps
  if (!isSupercarsSession(session.name)) return 0
  return KNOWN_RACE_LAPS.find((k) => k.meeting.test(session.meeting) && (!k.race || k.race.test(session.name)))?.laps ?? 0
}

/**
 * The lap the leader is on, as broadcasts count it: laps completed + 1, so "Lap 161 / 161" is the final lap.
 * Capped at the race distance, and the distance once the leader has finished or the flag is out. 0 = no laps yet
 * known (before the leader's first crossing of the line, or no cars).
 */
export function leaderLap(timing: { session: SessionInfo; cars: { position: number; laps: number }[] }): { lap: number; finished: boolean } {
  const total = raceLaps(timing.session)
  const leader = timing.cars.find((c) => c.position === 1) ?? timing.cars[0]
  const done = leader?.laps ?? 0
  const flag = timing.session.flag.toLowerCase()
  const finished = (total > 0 && done >= total) || flag === 'checkered' || flag === 'ended'
  if (finished) return { lap: total > 0 ? Math.min(done, total) : done, finished }
  const lap = done + 1
  return { lap: total > 0 ? Math.min(lap, total) : lap, finished }
}

/**
 * Minimum laps each driver must complete, at endurance events (0 = no rule). Bathurst 1000: 60 of 161 laps
 * (2026, with the fuel capacity change:
 * https://www.v8sleuth.com.au/supercars-adjusts-fuel-capacity-change-for-enduros-finals/).
 * Check the sporting regulations each year.
 */
export function minDriverLaps(session: SessionInfo): number {
  return raceLaps(session) > 0 && /bathurst 1000/i.test(session.meeting) ? 60 : 0
}

/**
 * The main championship. Support categories (Super2, TCM, Carrera Cup...) share Natsoft's V8SUPER feed;
 * they're still recorded, but the app only shows Supercars.
 */
export function isSupercarsSession(sessionName: string): boolean {
  return /supercars championship/i.test(sessionName)
}

export type FlagKind = 'green' | 'caution' | 'red' | 'finished' | 'other'

/**
 * What a Natsoft session flag means. Support races sent "Yellow" for a full-course caution; what Natsoft sends for a
 * Supercars safety car isn't confirmed yet, so likely alternatives ("SC", "FCY", "Safety Car") count as caution too.
 */
export function flagKind(flag: string): FlagKind {
  const f = flag.trim().toLowerCase()
  if (f === 'green') return 'green'
  if (/\bred\b|suspend|stopped/.test(f)) return 'red'
  if (/yellow|\bsc\b|safety|\bfcy\b|caution|\bvsc\b/.test(f)) return 'caution'
  if (/check|chequer|ended|finish/.test(f)) return 'finished'
  return 'other'
}

/** Caution periods (SC/FCY) from the flag history, oldest first; `end` is undefined while one is still out. */
export function cautionPeriods(history: { time: number; flag: string }[] | undefined): { start: number; end?: number }[] {
  return flagPeriods(history, 'caution')
}

/** Periods under one kind of flag (caution, red...) from the flag history, oldest first; `end` undefined while it's out. */
export function flagPeriods(history: { time: number; flag: string }[] | undefined, kind: FlagKind): { start: number; end?: number }[] {
  const out: { start: number; end?: number }[] = []
  for (const f of history ?? []) {
    const caution = flagKind(f.flag) === kind
    const open = out.length > 0 && out[out.length - 1].end === undefined
    if (caution && !open) out.push({ start: f.time })
    else if (!caution && open) out[out.length - 1].end = f.time
  }
  return out
}
