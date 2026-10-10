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
const KNOWN_RACE_LAPS: { meeting: RegExp; laps: number }[] = [{ meeting: /bathurst 1000/i, laps: 161 }]

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
