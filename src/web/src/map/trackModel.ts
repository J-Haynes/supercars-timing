import type { TrackDefinition } from '../tracks/types'

export interface Vec {
  x: number
  y: number
}

/** A track's pit lane in driving order: its points, metres along it at each, and where it leaves and rejoins the lap. */
export interface PitLane {
  path: Vec[]
  along: number[]
  length: number
  /** Lap distances nearest the pit lane's two ends. */
  entry: number
  exit: number
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

  private pit: PitLane | null | undefined
  /**
   * The pit lane in driving order, or null without one. Track files list it either way round (Bathurst's runs from
   * the exit to the entry), so the entry is the end the other is a short way forward from: a pit lane bypasses a
   * short piece of the lap.
   */
  get pitLane(): PitLane | null {
    if (this.pit !== undefined) return this.pit
    const lane = this.def.pitLane
    if (lane.length < 2) return (this.pit = null)
    const a = this.nearestDistance(lane[0])
    const b = this.nearestDistance(lane[lane.length - 1])
    const forward = this.wrap(b - a) <= this.wrap(a - b)
    const path = (forward ? lane : [...lane].reverse()).map(([x, y]) => ({ x, y }))
    const along = [0]
    for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
    return (this.pit = { path, along, length: along[along.length - 1], entry: forward ? a : b, exit: forward ? b : a })
  }

  /** Distance along the lap nearest the pit lane's exit (where cars rejoin), or null without a pit lane. */
  get pitExitDistance(): number | null {
    return this.pitLane?.exit ?? null
  }

  /** The point `metres` along the pit lane from its entry (clamped to the lane). */
  pitPointAt(metres: number): Vec {
    const pit = this.pitLane
    if (!pit) return this.pointAt(0)
    const d = Math.min(Math.max(metres, 0), pit.length)
    let i = 1
    while (i < pit.along.length - 1 && pit.along[i] < d) i++
    const t = (d - pit.along[i - 1]) / (pit.along[i] - pit.along[i - 1] || 1)
    const p = pit.path[i - 1]
    const q = pit.path[i]
    return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }
  }

  /** Distance along the lap of the centreline sample nearest `p`. */
  nearestDistance([px, py]: [number, number]): number {
    let best = Infinity
    let at = 0
    this.def.path.forEach(([x, y], i) => {
      const d = (x - px) ** 2 + (y - py) ** 2
      if (d < best) { best = d; at = i * this.def.step }
    })
    return at
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

  /** Position at distance d, `lateral` metres left of the centreline (right if negative). */
  pointBeside(d: number, lateral: number): Vec {
    const p = this.pointAt(d)
    if (!lateral) return p
    const n = this.normalAt(d)
    return { x: p.x + n.x * lateral, y: p.y + n.y * lateral }
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
