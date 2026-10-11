import { isF1 } from './series'

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
  /** Supercars sessions, local track time, when the schedule is published (provisional until the weekend). */
  sessions?: EventSession[]
  /** Where the session times came from. */
  sessionsSource?: string
}

export interface EventSession {
  name: string
  /** Local track time, "YYYY-MM-DDTHH:MM". */
  start: string
  end?: string
  /** Race distance, if it's a race. */
  laps?: number
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
    // "Correct as of Wednesday September 16" (Supercars); times can still change.
    sessionsSource: 'https://www.supercars.com/news/supercars-news-2026-gold-coast-500-track-schedule-race-start-times-tickets-tv-enduro-cup-sessions',
    sessions: [
      { name: 'Practice 1', start: '2026-10-23T11:45', end: '2026-10-23T12:10' },
      { name: 'Practice 2', start: '2026-10-23T13:50', end: '2026-10-23T14:15' },
      { name: 'Qualifying (Race 31)', start: '2026-10-23T16:05', end: '2026-10-23T16:35' },
      { name: 'Top Ten Shootout (Race 31)', start: '2026-10-24T12:35', end: '2026-10-24T13:10' },
      { name: 'Race 31', start: '2026-10-24T15:15', laps: 85 },
      { name: 'Qualifying 1 (Race 32)', start: '2026-10-25T11:20', end: '2026-10-25T11:32' },
      { name: 'Qualifying 2 (Race 32)', start: '2026-10-25T11:40', end: '2026-10-25T11:52' },
      { name: 'Top Ten Shootout (Race 32)', start: '2026-10-25T12:05', end: '2026-10-25T12:40' },
      { name: 'Race 32', start: '2026-10-25T14:45', laps: 85 },
    ],
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

/**
 * Remaining 2026 Formula 1 rounds. Session times from the Jolpica F1 API (the community continuation of Ergast),
 * fetched 11 Oct 2026, converted to local track time with the UTC offsets F1's live timing used at these circuits
 * in 2025 (Austin -05:00, Mexico City -06:00, São Paulo -03:00, Las Vegas -08:00, Lusail +03:00, Yas Marina +04:00).
 * Practice and qualifying are shown as an hour long. Track maps were built from each circuit's 2025 qualifying
 * (tools/F1TrackBuilder); rebuild them after Practice 1 if F1 changes the mini-sectors.
 */
const SOURCE = 'https://api.jolpi.ca/ergast/f1/2026/races/'

export const F1_UPCOMING: UpcomingEvent[] = [
  {
    name: 'Singapore Grand Prix', venue: 'Marina Bay Street Circuit', location: 'Singapore',
    startDate: '2026-10-09', endDate: '2026-10-11', utcOffset: '+08:00', trackCode: 'F1-61',
    format: 'Round 17',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-10-09T16:30', end: '2026-10-09T17:30' },
      { name: 'Sprint Qualifying', start: '2026-10-09T20:30', end: '2026-10-09T21:30' },
      { name: 'Sprint', start: '2026-10-10T17:00' },
      { name: 'Qualifying', start: '2026-10-10T21:30', end: '2026-10-10T22:30' }, // F1's session index (Jolpica: 21:00)
      { name: 'Race', start: '2026-10-11T20:00' },
    ],
  },
  {
    name: 'United States Grand Prix', venue: 'Circuit of the Americas', location: 'Austin, Texas',
    startDate: '2026-10-23', endDate: '2026-10-25', utcOffset: '-05:00', trackCode: 'F1-9',
    format: 'Round 18',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-10-23T12:30', end: '2026-10-23T13:30' },
      { name: 'Practice 2', start: '2026-10-23T16:00', end: '2026-10-23T17:00' },
      { name: 'Practice 3', start: '2026-10-24T12:30', end: '2026-10-24T13:30' },
      { name: 'Qualifying', start: '2026-10-24T16:00', end: '2026-10-24T17:00' },
      { name: 'Race', start: '2026-10-25T15:00' },
    ],
  },
  {
    name: 'Mexico City Grand Prix', venue: 'Autódromo Hermanos Rodríguez', location: 'Mexico City',
    startDate: '2026-10-30', endDate: '2026-11-01', utcOffset: '-06:00', trackCode: 'F1-65',
    format: 'Round 19',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-10-30T12:30', end: '2026-10-30T13:30' },
      { name: 'Practice 2', start: '2026-10-30T16:00', end: '2026-10-30T17:00' },
      { name: 'Practice 3', start: '2026-10-31T11:30', end: '2026-10-31T12:30' },
      { name: 'Qualifying', start: '2026-10-31T15:00', end: '2026-10-31T16:00' },
      { name: 'Race', start: '2026-11-01T14:00' },
    ],
  },
  {
    name: 'Brazilian Grand Prix', venue: 'Autódromo José Carlos Pace (Interlagos)', location: 'São Paulo',
    startDate: '2026-11-06', endDate: '2026-11-08', utcOffset: '-03:00', trackCode: 'F1-14',
    format: 'Round 20',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-11-06T12:30', end: '2026-11-06T13:30' },
      { name: 'Practice 2', start: '2026-11-06T16:00', end: '2026-11-06T17:00' },
      { name: 'Practice 3', start: '2026-11-07T11:30', end: '2026-11-07T12:30' },
      { name: 'Qualifying', start: '2026-11-07T15:00', end: '2026-11-07T16:00' },
      { name: 'Race', start: '2026-11-08T14:00' },
    ],
  },
  {
    name: 'Las Vegas Grand Prix', venue: 'Las Vegas Strip Circuit', location: 'Las Vegas, Nevada',
    startDate: '2026-11-19', endDate: '2026-11-21', utcOffset: '-08:00', trackCode: 'F1-152',
    format: 'Round 21',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-11-19T16:30', end: '2026-11-19T17:30' },
      { name: 'Practice 2', start: '2026-11-19T20:00', end: '2026-11-19T21:00' },
      { name: 'Practice 3', start: '2026-11-20T16:30', end: '2026-11-20T17:30' },
      { name: 'Qualifying', start: '2026-11-20T20:00', end: '2026-11-20T21:00' },
      { name: 'Race', start: '2026-11-21T20:00' },
    ],
  },
  {
    name: 'Qatar Grand Prix', venue: 'Lusail International Circuit', location: 'Lusail',
    startDate: '2026-11-27', endDate: '2026-11-29', utcOffset: '+03:00', trackCode: 'F1-150',
    format: 'Round 22',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-11-27T16:30', end: '2026-11-27T17:30' },
      { name: 'Practice 2', start: '2026-11-27T20:00', end: '2026-11-27T21:00' },
      { name: 'Practice 3', start: '2026-11-28T17:30', end: '2026-11-28T18:30' },
      { name: 'Qualifying', start: '2026-11-28T21:00', end: '2026-11-28T22:00' },
      { name: 'Race', start: '2026-11-29T19:00' },
    ],
  },
  {
    name: 'Abu Dhabi Grand Prix', venue: 'Yas Marina Circuit', location: 'Abu Dhabi',
    startDate: '2026-12-04', endDate: '2026-12-06', utcOffset: '+04:00', trackCode: 'F1-70',
    format: 'Round 23',
    sessionsSource: SOURCE,
    sessions: [
      { name: 'Practice 1', start: '2026-12-04T13:30', end: '2026-12-04T14:30' },
      { name: 'Practice 2', start: '2026-12-04T17:00', end: '2026-12-04T18:00' },
      { name: 'Practice 3', start: '2026-12-05T14:30', end: '2026-12-05T15:30' },
      { name: 'Qualifying', start: '2026-12-05T18:00', end: '2026-12-05T19:00' },
      { name: 'Race', start: '2026-12-06T17:00' },
    ],
  },
]

/** Upcoming events for the app on screen (Supercars or F1). */
export const SERIES_UPCOMING = isF1 ? F1_UPCOMING : UPCOMING

export function eventStart(e: UpcomingEvent): Date {
  return new Date(`${e.startDate}T00:00:00${e.utcOffset}`)
}

/** End of the event's last day, local track time. */
export function eventEnd(e: UpcomingEvent): Date {
  return new Date(`${e.endDate}T23:59:59${e.utcOffset}`)
}

/** A session's start (or end) as a Date, from its local track time and the event's UTC offset. */
export function sessionTime(e: UpcomingEvent, local: string): Date {
  return new Date(`${local}:00${e.utcOffset}`)
}
