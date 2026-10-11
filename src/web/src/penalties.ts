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
 * A car's penalties from race control, and whether each has been served.
 *
 * Natsoft never says a penalty was served, and the pit-lane time doesn't show it reliably: Payne's stop after his
 * 5 s penalty took 66.1 s, a normal time (less other work, presumably), yet the broadcast shows him held for it.
 * So this follows the procedure instead: a penalty is served at the car's first completed pit stop that started
 * after it was issued. With no stop after it, it stays unserved (a time penalty is then added to the race time).
 */
export function carPenalties(car: CarRow, timing: TimingSnapshot): CarPenalty[] {
  const out: CarPenalty[] = []
  for (const m of [...(timing.raceControl ?? [])].reverse()) { // oldest first
    const p = m.text.match(/\bPenalty\s+Car\s+(\d+)\s*-\s*([^-]+)/i)
    if (!p || p[1] !== car.carNumber) continue
    const what = p[2].trim()
    const seconds = Number(what.match(/(\d+)\s*sec/i)?.[1] ?? 0)
    const used = new Set(out.map((x) => x.servedAt))
    const servedAt = (car.pitLog ?? []).find((s) => s.inAt > m.time && s.outAt > 0 && !used.has(s))
    out.push({ what, seconds, issuedAt: m.time, servedAt })
  }
  return out
}

/** Seconds of time penalties still to be added to the car's race time. */
export function unservedSeconds(car: CarRow, timing: TimingSnapshot): number {
  return carPenalties(car, timing).filter((p) => !p.servedAt).reduce((s, p) => s + p.seconds, 0)
}
