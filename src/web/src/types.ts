// Mirrors the server DTOs (SupercarsTiming.Natsoft.TimingSnapshot, Server.Hubs.TimingUpdate).
// Times are seconds; 0 means "no time yet".

export type FeedState = 'starting' | 'connecting' | 'waiting' | 'live' | 'replaying' | 'error' | 'ended'

export interface FeedStatus {
  mode: 'Live' | 'Replay'
  state: FeedState
  detail: string | null
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
  /** Gap/interval updated at every timing point. Prefer these during races. */
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
}

export interface TimingSnapshot {
  session: SessionInfo
  timingPoints: TimingPoint[]
  best: BestTimes
  cars: CarRow[]
  now: number
  messageCount: number
}

export interface TimingUpdate {
  feed: FeedStatus
  timing: TimingSnapshot
}
