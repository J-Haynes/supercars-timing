// Mirrors the server DTOs (SupercarsTiming.Natsoft.TimingSnapshot, Server.Hubs.TimingUpdate).
// Times are seconds; 0 means "no time yet".

export type FeedState = 'starting' | 'connecting' | 'waiting' | 'live' | 'replaying' | 'error' | 'ended'

export interface FeedStatus {
  mode: 'Live' | 'Replay'
  state: FeedState
  detail: string | null
  /** Session seconds per real second (replay speed; 1 live; 0 when a replay has ended). */
  clockRate: number
}

export interface SessionInfo {
  meeting: string
  name: string
  type: string
  track: string
  trackCode: string
  flag: string
  clockRemaining: number | null
  clockElapsed: number | null
  /** Scheduled race laps from Natsoft; 0 = not sent (see raceLaps() in session.ts). */
  scheduledLaps: number
  /** Natsoft time of the first green flag (race start); 0 = not seen. Optional: older servers don't send it. */
  greenAt?: number
  /** Lap record for this session type at this track, if Natsoft sends one. */
  lapRecord?: LapRecord | null
}

export interface LapRecord {
  seconds: number
  driver: string
  vehicle: string
}

/** A race control message (incidents, investigations, penalties). `time` is Natsoft time. */
export interface RaceControlMessage {
  time: number
  text: string
}

export interface TimingPoint {
  id: string
  name: string
}

export interface BestTimes {
  lap: number | null
  s1: number | null
  s2: number | null
  s3: number | null
  speed: number | null
}

export interface CarRow {
  id: string
  position: number
  carNumber: string
  driver: string
  vehicle: string
  manufacturer: string
  laps: number
  lastLap: number
  bestLap: number
  bestLapNo: number
  gap: number
  gapLaps: number
  interval: number
  intervalLaps: number
  /** LGI/LGNI fields: meaning unclear, often out of step with race order. Not shown in the UI. */
  liveGap: number
  liveGapLaps: number
  liveInterval: number
  liveIntervalLaps: number
  s1: number
  s2: number
  s3: number
  bestS1: number
  bestS2: number
  bestS3: number
  speed: number
  pitStops: number
  inPit: boolean
  /** "M" = control line, otherwise a TimingPoint id. */
  lastPoint: string
  lastPointAt: number
  /** Expected seconds from each point to the next, in point order (M, then timingPoints). 0 = unknown. */
  segmentSeconds: number[]
  /** Natsoft time the current lap started (control-line crossing); 0 = unknown, e.g. on an out-lap. */
  lapStartAt: number
  /** Laps started since leaving the pits: 0 = out-lap, 1 = first flying lap, 2+ = later laps. */
  lapsSincePit: number
  /** Cumulative seconds from the line at each timing point, then the lap time last. 0 = not reached/unknown. */
  currentSplits: number[]
  lastLapSplits: number[]
  bestLapSplits: number[]
  /** All drivers entered in the car (two at co-driver events), in Natsoft's order. */
  drivers: string[]
  /** Which of `drivers` is in the car: "1", "2"... */
  driverIndex: string
  /** Natsoft time of the last driver swap this session; 0 = none. */
  driverChangedAt: number
  /** Mini-sector times in point order (index i = stretch from point i to the next). 0 = no time. */
  currentSegments: number[]
  lastLapSegments: number[]
  bestSegments: number[]
  /** Laps completed by each driver, in `drivers` order (Natsoft's own count when it sends one). */
  driverLaps: number[]
  /** Laps completed before we connected that we can't credit to a driver. */
  unattributedLaps: number
  /** Laps since the last pit exit (or the start). */
  stintLaps: number
  /** Pit stops seen live, oldest first. */
  pitLog: PitStopRow[]
  /** Natsoft's position on the road at the last timing point; 0 / missing = not sent. */
  roadPosition?: number
  /** Penalties from race control, e.g. "5 seconds". */
  penalties?: string[]
}

export interface PitStopRow {
  lap: number
  /** Natsoft time the car entered the pit lane. */
  inAt: number
  /** Natsoft time it left; 0 while still in the pits. */
  outAt: number
  /** Seconds in the pit lane; 0 while still in (or if we missed the exit). */
  seconds: number
  driverIn: string
  driverOut: string
}

export interface TimingSnapshot {
  session: SessionInfo
  timingPoints: TimingPoint[]
  best: BestTimes
  cars: CarRow[]
  /** Field-typical seconds per segment, in point order. 0 = unknown. */
  segmentReference: number[]
  /** Fastest time anyone has done through each stretch this session (purple mini-sector). */
  segmentBest: number[]
  /** Latest race control messages, newest first. */
  raceControl?: RaceControlMessage[]
  /** Flag changes this session, oldest first (`time` is Natsoft time). Optional: older servers don't send it. */
  flagHistory?: { time: number; flag: string }[]
  now: number
  messageCount: number
}

export interface TimingUpdate {
  feed: FeedStatus
  timing: TimingSnapshot
}

/** A recorded session (GET /api/sessions); its results come from GET /api/sessions/{id}/results. */
export interface RecordedSession {
  id: string
  meeting: string
  name: string
  type: string
  track: string
  trackCode: string
  start: string
  end: string
  durationSeconds: number
  messages: number
}
