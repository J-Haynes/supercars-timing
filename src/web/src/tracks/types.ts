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
  /** Latitude/longitude of (0, 0) in `path` (metres east/north of it). Missing in F1 tracks (F1's own x/y). */
  origin?: [number, number]
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

/** Scenery for the 3D map (TrackBuilder --scenery, tracks/scenery/<CODE>.json), in the track file's metres. */
export interface SceneryDefinition {
  attribution: string
  /** [minX, minY, maxX, maxY]: everything is clipped to this box around the circuit. */
  box: [number, number, number, number]
  /** Footprint rings with height and base in metres; `assumed` = no height or levels in OSM (drawn 2 storeys). */
  buildings: { h: number; min: number; ring: [number, number][]; assumed: boolean; shape?: 'sphere' | null }[]
  /** Lakes, rivers and the sea. */
  water: SceneryArea[]
  beach: SceneryArea[]
  parks: SceneryArea[]
  /** Named attractions, stadiums and tall named buildings (h = height in m, 0 when not a building). Newer files only. */
  landmarks?: { name: string; at: [number, number]; h: number }[]
  /** Corner labels for tracks whose own file has none (F1: OSM's "Turn N" nodes), metres along the lap. */
  corners?: { name: string; distance: number }[]
}

export interface SceneryArea {
  outer: [number, number][]
  holes: [number, number][][]
}
