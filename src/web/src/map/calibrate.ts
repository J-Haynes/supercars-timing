import type { TrackDefinition } from '../tracks/types'

/**
 * Places Natsoft's timing points on a provisional track from live pace, the same way tools/TrackBuilder
 * does from a recording: each point goes where the simulated car is at the measured time into the lap.
 *
 * @param order     point order, "M" first
 * @param names     display names keyed by point id
 * @param reference typical seconds from each point to the next (the snapshot's segmentReference)
 * @returns timing points, or null until every segment has a time
 */
export function calibrateTimingPoints(
  track: TrackDefinition, order: string[], names: Record<string, string>, reference: number[] | undefined,
): TrackDefinition['timingPoints'] | null {
  if (!reference || reference.length !== order.length || reference.some((r) => !(r > 0))) return null
  const total = reference.reduce((a, b) => a + b, 0)
  const sim = track.simTime
  const lapSim = sim[sim.length - 1]
  const distanceAt = (t: number) => {
    let lo = 0
    let hi = sim.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (sim[mid] <= t) lo = mid
      else hi = mid
    }
    return (lo + (t - sim[lo]) / (sim[hi] - sim[lo] || 1)) * track.step
  }
  let elapsed = 0
  return order.map((id, i) => {
    const distance = id === 'M' ? 0 : distanceAt((elapsed / total) * lapSim)
    elapsed += reference[i]
    return { id, name: names[id] ?? id, distance: Math.round(distance * 10) / 10 }
  })
}
