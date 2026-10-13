import { useMemo } from 'react'
import type { CarRow, TimingSnapshot } from '../types'
import type { TrackDefinition } from '../tracks/types'
import type { TrackModel } from '../map/trackModel'
import type { Placement } from '../map/useCarPlacement'
import { flagKind, isRace, raceLaps } from '../session'
import { estimateLoss, measuredStops, type LossEstimate, type LossRange } from './pitLoss'
import { predictRejoin, progressModel, type Rejoin } from './rejoin'

/** Why there's no ghost right now (the panel says so instead). */
export type GhostStatus = 'ok' | 'caution' | 'in-pit' | 'finished' | 'unavailable'

export interface PitGhost {
  car: CarRow
  status: GhostStatus
  estimate: LossEstimate | null
  rejoin: Rejoin | null
  /** Reference lap in seconds (the session's typical lap), to turn seconds into track distance on the map. */
  refLap: number
}

/**
 * "If they pitted now" for one car (an experimental estimate: pitLoss.ts for the cost of a stop, rejoin.ts for where
 * it comes out). Worked out when the timing changes; the maps place the ghost every frame (ghostDistances).
 * Null when no car is chosen or it isn't a race.
 */
export function usePitGhost(timing: TimingSnapshot | undefined, track: TrackDefinition | null | undefined, carNumber: string | null): PitGhost | null {
  return useMemo(() => {
    const car = carNumber && timing ? timing.cars.find((c) => c.carNumber === carNumber && !c.retired) : undefined
    if (!car || !timing || !track || !isRace(timing.session.type)) return null
    const flag = flagKind(timing.session.flag)
    const order = ['M', ...timing.timingPoints.map((p) => p.id)]
    const fallback = order.map((id) => track.segmentSeconds.find((s) => s.from === id)?.seconds || 0)
    const m = progressModel(timing, fallback)
    const base = { car, estimate: null, rejoin: null, refLap: m?.lap ?? 0 }
    if (flag === 'finished') return { ...base, status: 'finished' }
    // Under a safety car a stop costs far less (2025 Gold Coast: ~3-9 s instead of ~45 s), too few measured to predict.
    if (flag === 'caution' || flag === 'red') return { ...base, status: 'caution' }
    if (car.inPit) return { ...base, status: 'in-pit' }
    if (!m) return { ...base, status: 'unavailable' }
    const measured = measuredStops(timing, track.code)
    const laps = raceLaps(timing.session)
    const estimate = estimateLoss(car.pitLog.length + 1, track.code, measured, laps)
    // Cars already in the pit lane: they'll lose their own stop's cost (median) relative to the field.
    const lossOf = (c: CarRow) => estimateLoss(Math.max(1, c.pitLog.length), track.code, measured, laps).range[1]
    const rejoin = predictRejoin(timing, car, estimate.range, m, timing.now, lossOf)
    return { car, status: rejoin ? 'ok' : 'unavailable', estimate, rejoin, refLap: m.lap }
  }, [timing, track, carNumber])
}

/**
 * Where the ghost goes on the map: `loss` seconds of racing behind the car's current spot, for the low, median and
 * high loss (metres along the lap). Uses the track's simulated lap, scaled to the session's reference lap.
 */
export function ghostDistances(model: TrackModel, carDistance: number, loss: LossRange, refLap: number): [number, number, number] {
  const scale = model.lapSimTime / refLap
  const at = (seconds: number) => {
    const t = model.simTimeAt(model.wrap(carDistance)) - seconds * scale
    const wrapped = ((t % model.lapSimTime) + model.lapSimTime) % model.lapSimTime
    return model.distanceAtSimTime(wrapped)
  }
  return [at(loss[0]), at(loss[1]), at(loss[2])]
}

/**
 * Where the pit ghost goes this frame: behind the chosen car's dot by the stop's cost (low to high loss), or null when
 * there's nothing to draw (no estimate, or the car isn't on track). Shared by the 2D and 3D maps.
 */
export function ghostOnTrack(ghost: PitGhost | null | undefined, placements: Placement[], model: TrackModel) {
  if (!ghost || ghost.status !== 'ok' || !ghost.rejoin || !ghost.refLap) return null
  const pl = placements.find((p) => p.car.id === ghost.car.id)
  if (!pl || pl.kind !== 'track') return null
  const [near, mid, far] = ghostDistances(model, pl.distance, ghost.rejoin.loss, ghost.refLap)
  // From the far end (biggest loss) forward to the near end, across the line if need be.
  const to = near >= far ? near : near + model.length
  const label = `#${ghost.car.carNumber} pit → P${ghost.rejoin.position} (est.)`
  return { from: far, to, mid, car: ghost.car, label }
}
