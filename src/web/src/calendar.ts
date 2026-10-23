import { isF1 } from './series'
import schedule from './schedule/supercars.json'

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
  /** Note shown under the timetable (e.g. only the featured sessions are published). */
  sessionsNote?: string
  info?: EventInfo
}

/** What a viewer wants to know about the event before it starts: every value from a source in `sources`. */
export interface EventInfo {
  /** e.g. "Round 12 of 14 · Finals round 1 of 3". */
  round: string
  /** What the round decides. */
  stakes: string
  /** Label/value pairs: circuit, races, lap record, tyres, stops... */
  facts: { label: string; value: string }[]
  /** Last year's results at this event (only what a source confirms). */
  lastYear?: string
  /** The official event track map, or a note that it isn't out yet. */
  trackMap?: { label: string; url: string } | { note: string }
  sources: { label: string; url: string }[]
}

export interface EventSession {
  name: string
  /** Local track time, "YYYY-MM-DDTHH:MM". */
  start: string
  end?: string
  /** Race distance, if it's a race. */
  laps?: number
}

// Sources shared by the Finals rounds (checked 12 Oct 2026).
const FORMATS = { label: 'Supercars: 2026 formats and tyres', url: 'https://www.supercars.com/news/2026-supercars-championship-formats-tyres-explained-qualifying-practice-calendar-times-dates' }
const FINALS_RULES = { label: 'Supercars: 2026 Finals Series format', url: 'https://www.supercars.com/news/supercars-news-2026-finals-series-points-tweaks-explained-format-bonus-elimination-grand-final' }
const ELIMINATIONS = { label: 'Adelaide Grand Final: 2026 Finals rules (three out per round)', url: 'https://adelaidegrandfinal.com.au/latest-news/2026-finals-rule-changes-explained/' }
const CUP_BONUS = { label: 'Supercars: Enduro Cup winner, 25 Finals points', url: 'https://www.supercars.com/news/supercars-news-2026-enduro-cup-qualification-finals-bonus-points-explained-bathurst-1000' }
const SEASON = { label: 'Wikipedia: 2026 Supercars Championship (rounds)', url: 'https://en.wikipedia.org/wiki/2026_Supercars_Championship' }

const SUPERCARS_EVENTS: Omit<UpcomingEvent, 'startDate' | 'endDate' | 'utcOffset'>[] = [
  {
    name: 'Repco Bathurst 1000', venue: 'Mount Panorama Circuit', location: 'Bathurst, NSW', trackCode: 'MOUN',
    format: 'Enduro Cup · 161 laps, two drivers per car',
  },
  {
    name: 'Boost Mobile Gold Coast 500', venue: 'Surfers Paradise Street Circuit', location: 'Surfers Paradise, QLD', trackCode: 'SPSC',
    format: 'Finals round 1 · two 250 km races',
    info: {
      round: 'Round 12 of 14 · Finals round 1 of 3',
      stakes: 'The top 10 in the championship start the Finals. Points reset to 3000 plus a bonus by position after Bathurst (150, 120, 96 and 78 for the top four, then 66 down to 21) and 25 for the Sprint and Enduro Cup winners. After the two races the bottom three are eliminated: "only 7 drivers will remain in the title fight".',
      facts: [
        { label: 'Circuit', value: 'Surfers Paradise street circuit, 2.96 km, 14 numbered turns' },
        { label: 'Races', value: '2 × 250 km, 85 laps each (Races 31 and 32)' },
        { label: 'Tyres', value: 'Saturday Super Soft, Sunday Soft' },
        { label: 'Pit stops', value: '2 mandatory per race' },
        { label: 'Lap record', value: '1:10.0480, David Reynolds (2013)' },
        { label: 'Support', value: 'Porsche Carrera Cup, V8 Superutes, Aussie Racing Cars' },
        { label: 'On TV', value: 'Seven, 7plus, Foxtel, Kayo' },
      ],
      lastYear: '2025: Chaz Mostert won both races (Walkinshaw Andretti United, Ford Mustang), from poles by Ryan Wood and Broc Feeney.',
      trackMap: { label: 'Official track map (PDF)', url: 'https://assets.ctfassets.net/xd502h20t7lh/6r1B8LCvMh9bvEOWzbDPZ9/3ede3611fcaca36e4790c1f10bb1018c/SC26-GC-Track_Map-5_compressed.pdf' },
      sources: [
        { label: 'Supercars: event page (length, laps, lap record, Finals)', url: 'https://www.supercars.com/events/2026-gold-coast' },
        { label: 'Supercars: official track map (turns, support, TV)', url: 'https://assets.ctfassets.net/xd502h20t7lh/6r1B8LCvMh9bvEOWzbDPZ9/3ede3611fcaca36e4790c1f10bb1018c/SC26-GC-Track_Map-5_compressed.pdf' },
        FORMATS, FINALS_RULES, ELIMINATIONS, CUP_BONUS, SEASON,
        { label: 'Supercars: 2026 Finals field and starting points', url: 'https://www.supercars.com/news/supercars-news-2026-finals-drivers-field-bathurst-1000-qualified-set-payne-feeney-kostecki-brown' },
        { label: 'Speedcafe: championship standings after Bathurst', url: 'https://speedcafe.com/bathurst-1000-race/' },
        { label: 'Wikipedia: 2025 Gold Coast 500', url: 'https://en.wikipedia.org/wiki/2025_Gold_Coast_500' },
      ],
    },
  },
  {
    name: 'Penrite Oil Sandown 500', venue: 'Sandown International Motor Raceway', location: 'Melbourne, VIC', trackCode: 'SAND',
    format: 'Finals round 2 · two 250 km races',
    info: {
      round: 'Round 13 of 14 · Finals round 2 of 3 (semi-final)',
      stakes: 'Seven drivers left after the Gold Coast. Points reset again with the same bonus for the top four (150, 120, 96, 78); after the two races the bottom three are eliminated, leaving four for the Grand Final.',
      facts: [
        { label: 'Circuit', value: 'Sandown permanent circuit, 3.1 km (National Circuit, 13 turns)' },
        { label: 'Races', value: '2 × 250 km, 81 laps each (Races 33 and 34)' },
        { label: 'Tyres', value: 'Saturday Super Soft, Sunday Soft' },
        { label: 'Pit stops', value: '2 mandatory per race' },
        { label: 'Lap record', value: '1:07.2078, Will Davison (2022)' },
      ],
      lastYear: '2025: Chaz Mostert won Race 1 and Broc Feeney Race 2, both over 81 laps.',
      trackMap: { note: "Supercars hasn't published the 2026 event map yet (checked 12 Oct). The Gold Coast's came out three weeks before its event." },
      sources: [
        { label: 'Supercars: event page (length, lap record, featured sessions)', url: 'https://www.supercars.com/events/2026-sandown' },
        { label: 'Supercars Travel: 81 laps', url: 'https://travel.supercars.com/2026-sandown' },
        { label: 'Wikipedia: Sandown Raceway (13 turns)', url: 'https://en.wikipedia.org/wiki/Sandown_Raceway' },
        FORMATS, FINALS_RULES, ELIMINATIONS, SEASON,
        { label: 'Autosport: 2025 Sandown 500 results', url: 'https://www.autosport.com/supercars/results/2025/sandown-500-659853/?st=RACE1' },
      ],
    },
  },
  {
    name: 'bp Adelaide Grand Final', venue: 'Adelaide Street Circuit', location: 'Adelaide, SA', trackCode: 'ADEL',
    format: 'Finals round 3 · Grand Final, three races',
    info: {
      round: 'Round 14 of 14 · Finals round 3 of 3 (Grand Final)',
      stakes: '"Four drivers. Three races. One Champion." Points reset again with the bonus for the top four (150, 120, 96, 78); whoever leads after Race 37 is the champion.',
      facts: [
        { label: 'Circuit', value: 'Adelaide Parklands street circuit, 3.219 km, 14 turns; the last year of this layout (a new 4.13 km circuit from 2027)' },
        { label: 'Races', value: 'Friday 100 km (32 laps), Saturday and Sunday 250 km (78 laps each): Races 35-37' },
        { label: 'Tyres', value: 'Soft all weekend' },
        { label: 'Pit stops', value: '1, 2 and 2 mandatory' },
        { label: 'Lap record', value: '1:18.6763, Chaz Mostert (2022)' },
      ],
      lastYear: '2025: Chaz Mostert won the championship here, by 62 points.',
      trackMap: { note: "Supercars hasn't published the 2026 event map yet (checked 12 Oct)." },
      sources: [
        { label: 'Supercars: event page (length, laps, lap record, "Four drivers")', url: 'https://www.supercars.com/events/2026-adelaide' },
        { label: 'Supercars: track schedule', url: 'https://www.supercars.com/news/supercars-news-2026-adelaide-grand-final-track-schedule-revealed-times-racing-super2-series-finals-supports' },
        { label: 'Wikipedia: Adelaide Street Circuit (14 turns, 1999-2026)', url: 'https://en.wikipedia.org/wiki/Adelaide_Street_Circuit' },
        { label: 'SA Government: the 2027 circuit', url: 'https://dit.sa.gov.au/infrastructure/projects/circuit-redevelopment/design/during-events' },
        FORMATS, FINALS_RULES, ELIMINATIONS, SEASON,
        { label: 'Supercars: Mostert champion (2025)', url: 'https://www.supercars.com/news/supercars-news-2025-finals-standings-chaz-mostert-champion-adelaide-grand-final-broc-feeney' },
      ],
    },
  },
]

/**
 * Upcoming Supercars events: the details above, with dates and session times from schedule/supercars.json. That
 * file is shared with the server, which connects to Natsoft only from 30 minutes before each session.
 */
export const UPCOMING: UpcomingEvent[] = SUPERCARS_EVENTS.map((e) => {
  const timed = (schedule.events as ScheduleEvent[]).find((x) => x.name === e.name)
  if (!timed) throw new Error(`schedule/supercars.json has no "${e.name}"`)
  const { startDate, endDate, utcOffset, sessions, sessionsSource, sessionsNote } = timed
  return { ...e, startDate, endDate, utcOffset, sessions, sessionsSource, sessionsNote }
})

/** An event in schedule/supercars.json. `complete` false: not every session is timed yet. */
interface ScheduleEvent {
  name: string
  startDate: string
  endDate: string
  utcOffset: string
  sessions?: EventSession[]
  sessionsSource?: string
  sessionsNote?: string
  complete: boolean
}

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

/**
 * A live race's scheduled start from the timetable above, in the feeds' session time (track-local wall-clock time
 * encoded as Unix seconds, like Natsoft's T and F1's timestamps), or undefined if it isn't there. Matched by event
 * name inside the meeting ("2026 Boost Mobile Gold Coast 500") and session name ("... - Race 31" / F1's "Race").
 * The timetable's time is when the session starts, before the formation lap: the 2026 Singapore GP's green flag came
 * at 20:03:39 for a 20:00 start.
 */
export function scheduledStart(session: { meeting: string; name: string }): number | undefined {
  const name = session.name.split(' - ').at(-1)?.trim().toLowerCase()
  const event = SERIES_UPCOMING.find((e) => session.meeting.toLowerCase().includes(e.name.toLowerCase()))
  const race = event?.sessions?.find((s) => s.name.toLowerCase() === name)
  return race ? Date.parse(`${race.start}:00Z`) / 1000 : undefined
}
