/** Track file written by tools/TrackBuilder. Distances in metres along the lap from the control line. */
export interface TrackDefinition {
  code: string
  name: string
  /** Natsoft track-name fragments this file also applies to (when the track code isn't known yet). */
  match?: string[]
  /** Timing points not yet learned from a recording: the map places them from live pace. */
  provisional?: boolean
  /** The control line position is a guess (no Finish Line in the map data). */
  controlLineEstimated?: boolean
  source: { attribution: string; osmRelation: number; recording: string | null; built: string }
  length: number
  /** Metres between samples in `path` and `simTime`. */
  step: number
  /** Centreline samples [x east, y north] in metres, in race direction, starting at the control line. */
  path: [number, number][]
  /** Simulated cumulative seconds at each sample (one extra entry = full lap). */
  simTime: number[]
  /** Height in metres at each `path` sample, relative to the lap's lowest point (smoothed SRTM). Missing or null
   * when the track has none (F1 tracks; flat street circuits, where SRTM measures rooftops). */
  elevation?: number[] | null
  timingPoints: { id: string; name: string; distance: number }[]
  segmentSeconds: { from: string; seconds: number }[]
  labels: { name: string; distance: number }[]
  pitLane: [number, number][]
}
