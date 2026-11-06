import type { UpcomingEvent } from './calendar'

export interface Coverage {
  status: 'confirmed' | 'unconfirmed'
  channels: string[]
  source: string
  start?: string | null
  end?: string | null
  note?: string | null
  checkedAt?: string | null
  scope?: 'day' | 'programme' | 'session'
}
export interface WeekendSession {
  name: string
  category: string
  start: string
  end?: string | null
  main: boolean
  coverage?: Coverage | null
}
export interface Broadcast {
  title: string
  start: string
  end?: string | null
  channels: string[]
  source: string
  checkedAt?: string | null
  scope?: 'day' | 'programme'
}
export interface WeekendData {
  series: string
  eventName: string
  startDate: string
  scheduleSource: string
  checkedAt: string
  sessions: WeekendSession[]
  broadcasts: Broadcast[]
  note?: string | null
}
export interface Standing { position: number; name: string; points: number; team?: string | null }
export interface ChampionshipStandings {
  series: string
  season: number
  checkedAt: string
  asOf: string
  driversSource: string
  teamsSource: string
  drivers: Standing[]
  teams: Standing[]
  note?: string | null
  pointsRemaining?: { drivers: number; teams: number; races: number; sprints: number; driverResetsPending: boolean; source: string } | null
  completedRace?: number | null
  raceResults?: Record<string, string[]> | null
  racePoints?: Record<string, Record<string, number>> | null
  raceWinners?: Record<string, string> | null
}

/** Main timetables remain the fallback; weekend data never changes timing connection windows. */
export function weekendSessions(event: UpcomingEvent, weekend?: WeekendData | null): WeekendSession[] {
  const main = event.sessions?.map(s => ({
    ...s, category: 'Main championship', main: true,
    start: `${s.start}:00${event.utcOffset}`, end: s.end ? `${s.end}:00${event.utcOffset}` : undefined,
    coverage: weekend?.sessions.find(detail => detail.main && Date.parse(detail.start) === Date.parse(`${s.start}:00${event.utcOffset}`))?.coverage,
  })) ?? []
  const sessions = weekend?.sessions ?? main
  return [...sessions].sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
}

export function nextWeekend(events: UpcomingEvent[], weekends: (WeekendData | null)[], now: number): {
  event: UpcomingEvent; session: WeekendSession | null
} | null {
  for (const event of events) {
    const data = weekends.find(w => w?.eventName === event.name && w.startDate === event.startDate)
    const sessions = weekendSessions(event, data).filter(s => s.main)
    const session = sessions.find(s => Date.parse(s.end ?? s.start) > now)
    if (session) return { event, session }
    if (!sessions.length && Date.parse(`${event.startDate}T00:00:00${event.utcOffset}`) > now) return { event, session: null }
  }
  return null
}

export function coverageLabel(coverage?: Coverage | null): string {
  return coverage?.status === 'confirmed' ? 'Coverage confirmed' : 'Coverage unconfirmed'
}
