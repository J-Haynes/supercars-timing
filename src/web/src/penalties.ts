import type { CarRow, PitStopRow, TimingSnapshot } from './types'
import { flagKind } from './session'

export interface CarPenalty {
  /** As race control worded it, e.g. "5 seconds" or "plp". */
  what: string
  /** Why, e.g. "driving infringement". */
  reason: string
  /** "time" (seconds added), "plp" (pit lane penalty = drive-through) or "other". */
  kind: 'time' | 'plp' | 'other'
  /**
   * Seconds it costs while unserved: the time penalty itself, or for a PLP 25 s, the "pit lane drive-through
   * equivalent" Supercars stewards used when converting one to a post-race penalty (2018). 0 for others.
   */
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
  // Only caution and red count against it (not e.g. a chequered flag); flagKind handles Natsoft's naming.
  const blocks = (flag: string) => ['caution', 'red'].includes(flagKind(flag))
  if (blocks(flagAt(stop.inAt))) return false
  return !history.some((f) => f.time > stop.inAt && f.time <= stop.outAt && blocks(f.flag))
}

/** Drive-through equivalent for an unserved pit lane penalty (see CarPenalty.seconds). */
const PLP_SECONDS = 25

/**
 * Car number, penalty and reason from a race control message. Race control words them in different ways:
 * "Stewards: Penalty Car 19 - 5 seconds - driving infringement" and "Stewards: Penalty Car 19  plp  pit stop
 * infringement" (double spaces, no dashes; Bathurst 1000 2026). Null for anything that isn't a penalty.
 */
export function parsePenalty(text: string): { car: string; what: string; reason: string } | null {
  const m = text.match(/\bPenalty\s+Car\s+(\d+)\s*(?:-\s*)?(.*)$/i)
  if (!m) return null
  const [what = '', ...reason] = m[2].split(/\s+-\s+|\s{2,}/).map((s) => s.trim()).filter(Boolean)
  return what ? { car: m[1], what, reason: reason.join(' - ') } : null
}

function kindOf(what: string): CarPenalty['kind'] {
  if (/\d+\s*sec/i.test(what)) return 'time'
  if (/\bplp\b|pit\s*lane|drive\s*through/i.test(what)) return 'plp'
  return 'other'
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
 *
 * Pit lane penalties (PLP, a drive-through) are served by the next trip through the pit lane, which Natsoft logs
 * like a pit stop. The same no-SC/FCY/red condition is applied to them (an assumption: the current rule text for
 * drive-throughs wasn't found).
 */
export function carPenalties(car: CarRow, timing: TimingSnapshot): CarPenalty[] {
  const out: CarPenalty[] = []
  for (const m of [...(timing.raceControl ?? [])].reverse()) { // oldest first
    const p = parsePenalty(m.text)
    if (!p || p.car !== car.carNumber) continue
    const kind = kindOf(p.what)
    const seconds = kind === 'time' ? Number(p.what.match(/(\d+)\s*sec/i)?.[1] ?? 0) : kind === 'plp' ? PLP_SECONDS : 0
    const used = new Set(out.map((x) => x.servedAt))
    const servedAt = (car.pitLog ?? []).find((s) => s.inAt > m.time && s.outAt > 0 && !used.has(s) && servable(s, timing))
    out.push({ what: p.what, reason: p.reason, kind, seconds, issuedAt: m.time, servedAt })
  }
  return out
}

/** Seconds still owed for unserved penalties (time penalties, and a drive-through equivalent for a PLP). */
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
      text: p.kind === 'plp'
        ? `Penalty served: Car ${car.carNumber} (${p.servedAt!.driverIn || car.driver}) - pit lane penalty, through the pit lane on lap ${p.servedAt!.lap}`
        : `Penalty served: Car ${car.carNumber} (${p.servedAt!.driverIn || car.driver}) - ${p.what} at the lap ${p.servedAt!.lap} pit stop`,
      served: true as const,
    })))
}
