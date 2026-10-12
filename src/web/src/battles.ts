import type { CarRow, TimingSnapshot } from './types'
import { liveGap, parkedAtLine, raceOrder } from './liveGaps'
import { isF1 } from './series'

/** Within this many seconds of the car ahead is a battle (and, in F1, Overtake Mode range). */
export const BATTLE_SECONDS = 1

/**
 * A battle: consecutive cars on the road, on the same lap, each within a second of the one ahead. Two cars is a
 * battle, three or more a train (a "battle pack"). `intervals[i]` is car i+1's gap to car i; `spread` their sum.
 */
export interface Battle {
  cars: CarRow[]
  intervals: number[]
  spread: number
  /** Race position of the car at the front (road order while racing). */
  position: number
}

/**
 * Battles in a race, front of the field first. Supercars: our live gap at the last timing point each car crossed
 * (liveGaps.ts). F1: F1's own interval to the car ahead, which is already live. The ticker (insights.ts) and the map
 * both use this, so they always agree.
 */
export function battles(timing: TimingSnapshot): Battle[] {
  const cars = raceOrder(timing)
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const out: Battle[] = []
  let current: Battle | null = null
  const close = () => { if (current && current.cars.length >= 2) out.push(current); current = null }
  for (let i = 1; i < cars.length; i++) {
    const a = cars[i - 1], b = cars[i]
    // Cars in the pits, just out of them (parked at the line, liveGaps.ts) or retired aren't battling.
    const onTrack = [a, b].every((c) => !c.inPit && !parkedAtLine(c) && !c.retired)
    const interval = onTrack && a.laps === b.laps ? gap(b, a, order) : null
    if (interval !== null && interval < BATTLE_SECONDS) {
      if (!current) current = { cars: [a], intervals: [], spread: 0, position: i }
      current.cars.push(b)
      current.intervals.push(interval)
      current.spread += interval
    } else close()
  }
  close()
  return out
}

function gap(car: CarRow, ahead: CarRow, order: string[]): number | null {
  if (isF1) return car.intervalLaps === 0 && car.interval > 0 ? car.interval : null
  return liveGap(car, ahead, order)
}

/** "Battle for P3" for two cars, "P3–P6 train" for more: the label on the map. */
export function battleLabel(b: Battle): string {
  const last = b.position + b.cars.length - 1
  return b.cars.length === 2
    ? `Battle for P${b.position} · ${b.spread.toFixed(1)}s`
    : `P${b.position}–P${last} train · ${b.spread.toFixed(1)}s`
}

/** A battle drawn on the map: the stretch of track from the last car to the first (metres along the lap). */
export interface BattleSpan {
  /** Rear end; `to` can be past the lap length when the battle crosses the line (draw modulo the length). */
  from: number
  to: number
  /** Where the label goes: the car at the front. */
  front: number
  label: string
  /** F1: cars within a second of the car ahead, so in Overtake Mode range (an approximation: F1 decides it at a
   * detection point we can't see). Empty for Supercars, which has no Overtake Mode. */
  overtakeIds: string[]
}

const SPAN_MARGIN = 60 // metres of track shown beyond the first and last car (shorter hid under the dots)

/** Battles placed on the track this frame, from the cars' map distances (useCarPlacement). */
export function battleSpans(list: Battle[], distanceOf: Map<string, number>, lapLength: number): BattleSpan[] {
  const out: BattleSpan[] = []
  for (const b of list) {
    const front = distanceOf.get(b.cars[0].id)
    const rear = distanceOf.get(b.cars[b.cars.length - 1].id)
    if (front === undefined || rear === undefined) continue
    // The front car is ahead on the road: if its distance is smaller, the battle spans the line.
    const to = front >= rear ? front : front + lapLength
    if (to - rear > lapLength / 3) continue // placements disagree (a car just reset at a crossing): skip a frame
    out.push({
      from: rear - SPAN_MARGIN, to: to + SPAN_MARGIN, front, label: battleLabel(b),
      overtakeIds: isF1 ? b.cars.slice(1).map((c) => c.id) : [],
    })
  }
  return out
}
