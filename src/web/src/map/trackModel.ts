import type { TrackDefinition } from '../tracks/types'

export interface Vec {
  x: number
  y: number
}

/**
 * Geometry helpers over a TrackDefinition: positions along the lap, and the simulated
 * time/distance mapping used to slow cars down for corners.
 */
export class TrackModel {
  readonly length: number
  readonly lapSimTime: number
  readonly pointDistance: Map<string, number>

  constructor(readonly def: TrackDefinition) {
    this.length = def.length
    this.lapSimTime = def.simTime[def.simTime.length - 1]
    this.pointDistance = new Map(def.timingPoints.map((p) => [p.id, p.distance]))
  }

  /** Wraps any distance into [0, length). */
  wrap(d: number): number {
    return ((d % this.length) + this.length) % this.length
  }

  /** Centreline position at distance d. */
  pointAt(d: number): Vec {
    const { path, step } = this.def
    const n = path.length
    const f = this.wrap(d) / step
    const i = Math.floor(f) % n
    const j = (i + 1) % n
    const t = f - Math.floor(f)
    return { x: path[i][0] + t * (path[j][0] - path[i][0]), y: path[i][1] + t * (path[j][1] - path[i][1]) }
  }

  /** Unit normal (pointing left of race direction) at distance d. */
  normalAt(d: number): Vec {
    const a = this.pointAt(d - 15)
    const b = this.pointAt(d + 15)
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
  }

  /** Simulated seconds into the lap at distance d (0 <= d <= length). */
  simTimeAt(d: number): number {
    const { simTime, step } = this.def
    const f = Math.min(Math.max(d, 0), this.length) / step
    const i = Math.min(Math.floor(f), simTime.length - 2)
    return simTime[i] + (f - i) * (simTime[i + 1] - simTime[i])
  }

  /** Distance at which the simulated car reaches t seconds into the lap (0 <= t <= lapSimTime). */
  distanceAtSimTime(t: number): number {
    const { simTime, step } = this.def
    let lo = 0
    let hi = simTime.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (simTime[mid] <= t) lo = mid
      else hi = mid
    }
    const span = simTime[hi] - simTime[lo] || 1
    return Math.min((lo + (t - simTime[lo]) / span) * step, this.length)
  }

  /** SVG path data for the centreline (y flipped so north is up). */
  pathData(): string {
    return this.def.path.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${(-y).toFixed(1)}`).join('') + 'Z'
  }

  pitLaneData(): string {
    return this.def.pitLane.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${(-y).toFixed(1)}`).join('')
  }

  bounds() {
    const xs = this.def.path.map((p) => p[0]).concat(this.def.pitLane.map((p) => p[0]))
    const ys = this.def.path.map((p) => -p[1]).concat(this.def.pitLane.map((p) => -p[1]))
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  }
}
