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
    info: {
      round: 'Round 12 of 14 · Finals round 1 of 3',
      stakes: 'The top 10 in the championship start the Finals. Points reset, with a bonus for the top four going in (150, 120, 96, 78) and 25 for the Sprint and Enduro Cup winners. After the two races the bottom three are eliminated: "only 7 drivers will remain in the title fight".',
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
        { label: 'Wikipedia: 2025 Gold Coast 500', url: 'https://en.wikipedia.org/wiki/2025_Gold_Coast_500' },
      ],
    },
  },
  {
    name: 'Penrite Oil Sandown 500', venue: 'Sandown International Motor Raceway', location: 'Melbourne, VIC',
    startDate: '2026-11-06', endDate: '2026-11-08', utcOffset: '+11:00', trackCode: 'SAND',
    format: 'Finals round 2 · two 250 km races',
    // Only the featured sessions are on the event page so far (12 Oct 2026); the full track schedule isn't out.
    sessionsSource: 'https://www.supercars.com/events/2026-sandown',
    sessionsNote: 'Only the Shootouts and races are published so far; practice and qualifying times will follow.',
    sessions: [
      { name: 'Top Ten Shootout (Race 33)', start: '2026-11-07T12:05' },
      { name: 'Race 33', start: '2026-11-07T15:30', laps: 81 },
      { name: 'Top Ten Shootout (Race 34)', start: '2026-11-08T12:05' },
      { name: 'Race 34', start: '2026-11-08T15:30', laps: 81 },
    ],
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
    name: 'bp Adelaide Grand Final', venue: 'Adelaide Street Circuit', location: 'Adelaide, SA',
    startDate: '2026-11-26', endDate: '2026-11-29', utcOffset: '+10:30', trackCode: 'ADEL',
    format: 'Finals round 3 · Grand Final, three races',
    // "All times ACDT, correct as of Wednesday July 1" (Supercars).
    sessionsSource: 'https://www.supercars.com/news/supercars-news-2026-adelaide-grand-final-track-schedule-revealed-times-racing-super2-series-finals-supports',
    sessions: [
      { name: 'Practice 1', start: '2026-11-26T15:15', end: '2026-11-26T15:40' },
      { name: 'Practice 2', start: '2026-11-27T10:00', end: '2026-11-27T10:25' },
      { name: 'Qualifying 1 (Race 35)', start: '2026-11-27T13:10', end: '2026-11-27T13:22' },
      { name: 'Qualifying 2 (Race 35)', start: '2026-11-27T13:30', end: '2026-11-27T13:38' },
      { name: 'Race 35', start: '2026-11-27T16:20', laps: 32 },
      { name: 'Qualifying 1 (Race 36)', start: '2026-11-28T11:45', end: '2026-11-28T11:57' },
      { name: 'Qualifying 2 (Race 36)', start: '2026-11-28T12:05', end: '2026-11-28T12:17' },
      { name: 'Top Ten Shootout (Race 36)', start: '2026-11-28T12:35', end: '2026-11-28T13:10' },
      { name: 'Race 36', start: '2026-11-28T15:20', laps: 78 },
      { name: 'Qualifying 1 (Race 37)', start: '2026-11-29T11:45', end: '2026-11-29T11:57' },
      { name: 'Qualifying 2 (Race 37)', start: '2026-11-29T12:05', end: '2026-11-29T12:17' },
      { name: 'Top Ten Shootout (Race 37)', start: '2026-11-29T12:35', end: '2026-11-29T13:10' },
      { name: 'Race 37', start: '2026-11-29T15:15', laps: 78 },
    ],
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
