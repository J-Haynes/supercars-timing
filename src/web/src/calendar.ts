/**
 * Upcoming Repco Supercars Championship events, from https://www.supercars.com/calendar.
 * Supercars hadn't published session times when this was written, so countdowns run to the start of
 * each event's first day in local track time. Update this list as the calendar changes.
 */
export interface UpcomingEvent {
  name: string
  venue: string
  location: string
  /** First and last day, local track time. */
  startDate: string
  endDate: string
  /** Track's UTC offset during the event, e.g. "+10:00" (Queensland has no daylight saving). */
  utcOffset: string
  /** Natsoft track code of our track file, when there is one. */
  trackCode?: string
  format?: string
}

export const UPCOMING: UpcomingEvent[] = [
  {
    name: 'Repco Bathurst 1000', venue: 'Mount Panorama Circuit', location: 'Bathurst, NSW',
    startDate: '2026-10-08', endDate: '2026-10-11', utcOffset: '+11:00', trackCode: 'MOUN',
    format: 'Enduro Cup · 161 laps, two drivers per car',
  },
  {
    name: 'Boost Mobile Gold Coast 500', venue: 'Surfers Paradise Street Circuit', location: 'Surfers Paradise, QLD',
    startDate: '2026-10-23', endDate: '2026-10-25', utcOffset: '+10:00', trackCode: 'SURF',
    format: 'Finals round 1 · two 250 km races',
  },
  {
    name: 'Penrite Oil Sandown 500', venue: 'Sandown International Motor Raceway', location: 'Melbourne, VIC',
    startDate: '2026-11-06', endDate: '2026-11-08', utcOffset: '+11:00',
    format: 'Finals round 2 · two 250 km races',
  },
  {
    name: 'bp Adelaide Grand Final', venue: 'Adelaide Street Circuit', location: 'Adelaide, SA',
    startDate: '2026-11-26', endDate: '2026-11-29', utcOffset: '+10:30',
    format: 'Finals round 3',
  },
]

export function eventStart(e: UpcomingEvent): Date {
  return new Date(`${e.startDate}T00:00:00${e.utcOffset}`)
}

/** End of the event's last day, local track time. */
export function eventEnd(e: UpcomingEvent): Date {
  return new Date(`${e.endDate}T23:59:59${e.utcOffset}`)
}
