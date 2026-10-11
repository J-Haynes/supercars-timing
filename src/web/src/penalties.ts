import type { CarRow, PitStopRow, TimingSnapshot } from './types'

export interface CarPenalty {
  /** As race control worded it, e.g. "5 seconds". */
  what: string
  /** Seconds for a time penalty; 0 for others (drive-through etc.). */
  seconds: number
  /** Natsoft time race control issued it. */
  issuedAt: number
  /** The pit stop it was served at, if any. */
  servedAt?: PitStopRow
}

/**
 * Whether a penalty could be served at this stop: not if the SC, FCY or red flag was out at any point during it
 * (Natsoft shows those as a non-green session flag). Without a flag history (older server) we assume green.
 */
function servable(stop: PitStopRow, timing: TimingSnapshot): boolean {
  const history = timing.flagHistory ?? []
  const flagAt = (t: number) => [...history].reverse().find((f) => f.time <= t)?.flag ?? 'Green'
  if (flagAt(stop.inAt) !== 'Green') return false
  return !history.some((f) => f.time > stop.inAt && f.time <= stop.outAt && f.flag !== 'Green')
}

/**
 * A car's penalties from race control, and whether each has been served.
 *
 * Natsoft never says a penalty was served, and the pit-lane time doesn't show it reliably: Payne's stop after his
 * 5 s penalty took 66.1 s, a normal time (less other work, presumably), yet the broadcast shows him held for it.
 * So this follows the rule instead (Supercars B7.7.1.7, as amended for Bathurst 2024): a time penalty "must be
 * served at the Car's next Pit Stop" unless the stewards direct otherwise, but "may not be served while the SC, FCY
 * boards or Red Flag are displayed", so it carries over past a stop made under those. With no stop after it, it
 * stays unserved (it's then added to the race time).
 */
export function carPenalties(car: CarRow, timing: TimingSnapshot): CarPenalty[] {
  const out: CarPenalty[] = []
  for (const m of [...(timing.raceControl ?? [])].reverse()) { // oldest first
    const p = m.text.match(/\bPenalty\s+Car\s+(\d+)\s*-\s*([^-]+)/i)
    if (!p || p[1] !== car.carNumber) continue
    const what = p[2].trim()
    const seconds = Number(what.match(/(\d+)\s*sec/i)?.[1] ?? 0)
    const used = new Set(out.map((x) => x.servedAt))
    const servedAt = (car.pitLog ?? []).find((s) => s.inAt > m.time && s.outAt > 0 && !used.has(s) && servable(s, timing))
    out.push({ what, seconds, issuedAt: m.time, servedAt })
  }
  return out
}

/** Seconds of time penalties still to be added to the car's race time. */
export function unservedSeconds(car: CarRow, timing: TimingSnapshot): number {
  return carPenalties(car, timing).filter((p) => !p.servedAt).reduce((s, p) => s + p.seconds, 0)
}

/** "Penalty served" lines for the race control feed, one per served penalty, at the time the car left the pits. */
export function servedMessages(timing: TimingSnapshot): { time: number; text: string; served: true }[] {
  return timing.cars.flatMap((car) => carPenalties(car, timing)
    .filter((p) => p.servedAt)
    .map((p) => ({
      time: p.servedAt!.outAt,
      // The driver at that stop, not whoever is in the car now (co-drivers swap at later stops).
      text: `Penalty served: Car ${car.carNumber} (${p.servedAt!.driverIn || car.driver}) - ${p.what} at the lap ${p.servedAt!.lap} pit stop`,
      served: true as const,
    })))
}
