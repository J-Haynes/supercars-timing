import type { SessionInfo } from './types'

/** Practice, qualifying and shootouts are ranked by best lap; races by running order. */
export function isRace(sessionType: string): boolean {
  return sessionType.toLowerCase().includes('race')
}

/** Top Ten Shootout (or similar single-car runs), detected from Natsoft's session name/type. */
export function isShootout(sessionName: string, sessionType: string): boolean {
  return /shoot\s*-?out|top\s*(10|ten)/i.test(`${sessionName} ${sessionType}`)
}

/** Race distances Natsoft doesn't send (it sends <E L> = 0 for most races). */
const KNOWN_RACE_LAPS: { meeting: RegExp; laps: number }[] = [
  { meeting: /bathurst 1000/i, laps: 161 },
  // Both Gold Coast races: "85 laps or 1 lap after" a time limit (Supercars schedule, 16 Sep 2026).
  { meeting: /gold coast/i, laps: 85 },
]

/** Scheduled laps for a race: Natsoft's value if it sends one, else a known distance; 0 = unknown (e.g. timed). */
export function raceLaps(session: SessionInfo): number {
  if (!isRace(session.type)) return 0
  if (session.scheduledLaps > 0) return session.scheduledLaps
  if (!isSupercarsSession(session.name)) return 0
  return KNOWN_RACE_LAPS.find((k) => k.meeting.test(session.meeting))?.laps ?? 0
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
  const out: { start: number; end?: number }[] = []
  for (const f of history ?? []) {
    const caution = flagKind(f.flag) === 'caution'
    const open = out.length > 0 && out[out.length - 1].end === undefined
    if (caution && !open) out.push({ start: f.time })
    else if (!caution && open) out[out.length - 1].end = f.time
  }
  return out
}
