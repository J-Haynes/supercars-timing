import { useRef } from 'react'
import type { CarRow, TimingSnapshot } from './types'
import { notableBattles } from './battles'
import { flagKind, isRace, raceLaps } from './session'
import { raceFinished } from './liveGaps'
import { estimateLoss, measuredStops } from './pit/pitLoss'
import { progress, progressModel, type ProgressModel } from './pit/rejoin'

/**
 * Race signals for the tower (TimingTower), all worked out from timing data; the pit-adjusted ones are estimates:
 * - battles: the same notableBattles as the map and the race feed, drawn as a bracket joining the rows;
 * - the pit-adjusted ("net") leader: who'd lead if every car had made the same number of stops, shown softly and
 *   only while that isn't the car leading on the road (the pit cycle);
 * - undercuts: a car that has just stopped, close to a car that hasn't made that stop yet: would it be ahead if that
 *   car stopped now? When the other car stops, whether it worked. Margins while pending use the estimated stop cost;
 *   the result uses real crossings (in rebuilt races, tools/HistoricalRace, pit-lane times are estimates too).
 * Commentators work these out by hand and get them wrong (2025 Gold Coast Race 29: "Mostert has undercut him
 * massively... something in our calculations is not right"); docs/PLANNING.md, "What commentators talk about".
 */
export interface TowerSignals {
  /** Per car in a battle: where its row is in the bracket. */
  battle: Map<string, 'first' | 'mid' | 'last'>
  /** Pit-adjusted leader when it isn't the road leader: by how much (s) it leads the next car on that basis. */
  netLeader: { id: string; margin: number } | null
  /** Per undercutting car. */
  undercut: Map<string, Undercut>
}

export interface Undercut {
  /** The car being undercut. */
  target: CarRow
  /** Pending: seconds the undercutting car would be ahead (+) or behind (-) if the target stopped now. Done: the
   * real margin at the line after the target's stop. */
  margin: number
  state: 'pending' | 'worked' | 'failed'
}

/** An undercut counts as one while the stop was this recent (laps of racing since pit exit). */
const UNDERCUT_WINDOW_LAPS = 4
/** At pit entry the undercutting car was within this many seconds of its target on the road, either side (stopping
 * first from just ahead counts too: Mostert vs Waters, 2025 Gold Coast Race 29, was called an undercut). */
const UNDERCUT_NEAR = 3
/** Pending tags show while the margin is within this (a pit window at Bathurst otherwise had 9 at once). */
const UNDERCUT_SHOW = 5
/** Dropped when the margin goes beyond this either way: not a fight any more. */
const UNDERCUT_MAX = 8
/** A finished undercut stays on the tower this long. */
const RESULT_SECONDS = 60
/** The pit-adjusted leader shows once it has held the spot this long, leading by at least NET_MARGIN seconds. */
const NET_STABLE_SECONDS = 15
const NET_MARGIN = 1

interface Pending { attacker: string; target: string; targetStops: number; since: number; result?: Undercut; shownAt?: number }

/** Remembered between updates. */
export interface SignalMemory {
  pending: Map<string, Pending>
  /** Current pit-adjusted leader candidate and since when it has led. */
  net: { id: string; since: number } | null
  /** Each settled car's latest progress (seconds) and when, to know where a car was when it went into the pits. */
  lastProgress: Map<string, { p: number; at: number }>
}

/**
 * A car's progress estimate is only good once it has crossed a timing point since leaving the pits: until then
 * rejoin.progress holds it at the point it's heading for (measured on the rebuilt 2025 Gold Coast Race 29: right
 * after a stop a car looked up to ~10 s better off than it was, and the "net leader" flickered between cars).
 */
const settled = (c: CarRow) => !c.inPit && (c.pitLog.at(-1)?.outAt ?? 0) < c.lastPointAt

/** Signals for the tower; keeps a little memory to say whether undercuts worked. Empty outside a race. */
export function useTowerSignals(timing: TimingSnapshot, fallback: number[], trackCode: string): TowerSignals {
  const memory = useRef<{ key: string; signals: SignalMemory }>({ key: '', signals: newSignalMemory() })
  const key = `${timing.session.meeting}|${timing.session.name}`
  if (memory.current.key !== key) memory.current = { key, signals: newSignalMemory() }
  return towerSignals(timing, fallback, trackCode, memory.current.signals)
}

export const newSignalMemory = (): SignalMemory => ({ pending: new Map(), net: null, lastProgress: new Map() })

export function towerSignals(timing: TimingSnapshot, fallback: number[], trackCode: string, memory: SignalMemory): TowerSignals {
  const empty: TowerSignals = { battle: new Map(), netLeader: null, undercut: new Map() }
  if (!isRace(timing.session.type) || raceFinished(timing)) return empty

  const battle = new Map<string, 'first' | 'mid' | 'last'>()
  for (const b of notableBattles(timing)) {
    b.cars.forEach((c, i) => battle.set(c.id, i === 0 ? 'first' : i === b.cars.length - 1 ? 'last' : 'mid'))
  }

  // Pit-adjusted ones only under green: under a caution a stop costs far less and nobody knows how much.
  const m = progressModel(timing, fallback)
  if (flagKind(timing.session.flag) !== 'green' || !m) return { ...empty, battle }
  const measured = measuredStops(timing, trackCode)
  const laps = raceLaps(timing.session)
  const lossFor = (stopNumber: number) => estimateLoss(Math.max(1, stopNumber), trackCode, measured, laps).range[1]
  const lossOf = (c: CarRow) => lossFor(c.pitLog.length)
  const now = timing.now
  const running = timing.cars.filter((c) => !c.retired)
  const prog = new Map(running.map((c) => [c.id, progress(c, m, now, lossOf)]))
  const stopsDone = (c: CarRow) => c.pitLog.filter((s) => s.outAt > 0).length

  // Net order: every car charged for the stops it still owes compared with the cars that have made the most.
  const most = Math.max(0, ...running.map(stopsDone))
  const net = running
    .map((c) => {
      const p = prog.get(c.id)
      let owed = 0
      for (let s = stopsDone(c) + 1; s <= most; s++) owed += lossFor(s)
      return p === null || p === undefined || !settled(c) ? null : { car: c, p: p - owed }
    })
    .filter((x): x is { car: CarRow; p: number } => !!x)
    .sort((a, b) => b.p - a.p)
  const roadLeader = running.map((c) => ({ c, p: prog.get(c.id) })).filter((x) => x.p != null).sort((a, b) => b.p! - a.p!)[0]?.c
  // Only while some cars are settled out of the pits and others still owe stops, and once it has held for a bit.
  const unsettled = running.some((c) => !settled(c) && c.pitLog.length > 0 && now - (c.pitLog.at(-1)!.inAt || now) < 3 * m.lap)
  const candidate = net.length >= 2 && roadLeader && net[0].car.id !== roadLeader.id && most > 0 && net[0].p - net[1].p >= NET_MARGIN
    ? { id: net[0].car.id, margin: net[0].p - net[1].p } : null
  if (!unsettled) memory.net = candidate ? (memory.net?.id === candidate.id ? memory.net : { id: candidate.id, since: now }) : null
  const netLeader = candidate && memory.net?.id === candidate.id && now - memory.net.since >= NET_STABLE_SECONDS ? candidate : null

  const undercut = undercuts(running, prog, m, now, lossFor, stopsDone, memory)
  for (const c of running) {
    const p = prog.get(c.id)
    if (settled(c) && p != null) memory.lastProgress.set(c.id, { p, at: now })
  }
  return { battle, netLeader, undercut }
}

function undercuts(running: CarRow[], prog: Map<string, number | null>, m: ProgressModel, now: number,
  lossFor: (n: number) => number, stopsDone: (c: CarRow) => number, memory: SignalMemory): Map<string, Undercut> {
  const { pending } = memory
  const byId = new Map(running.map((c) => [c.id, c]))
  // New candidates, decided when a car goes into the pits: the car yet to make this stop that was nearest to it on the
  // road just before (its last settled progress, moved on at racing pace). Deciding later, from progress after the
  // stop and an estimated stop cost, missed the undercuts that worked best (a quicker stop than estimated).
  for (const a of running) {
    const stop = a.pitLog.at(-1)
    const before = memory.lastProgress.get(a.id)
    if (!a.inPit || !stop || stop.outAt > 0 || !before || pending.get(a.id)?.since === stop.inAt) continue
    const pa = before.p + (stop.inAt - before.at)
    let best: { car: CarRow; d: number } | null = null
    for (const b of running) {
      const pb = prog.get(b.id)
      if (b.id === a.id || !settled(b) || stopsDone(b) !== stopsDone(a) || pb == null) continue
      const d = pa - (pb - Math.max(0, now - stop.inAt)) // a's lead over b at a's pit entry (b's progress taken back to then)
      if (Math.abs(d) <= UNDERCUT_NEAR && (!best || Math.abs(d) < Math.abs(best.d))) best = { car: b, d }
    }
    if (best) pending.set(a.id, { attacker: a.id, target: best.car.id, targetStops: stopsDone(a), since: stop.inAt })
    else pending.delete(a.id)
  }

  const out = new Map<string, Undercut>()
  for (const [id, p] of [...pending]) {
    const a = byId.get(id)
    const b = byId.get(p.target)
    if (!a || !b) { pending.delete(id); continue }
    if (p.result) {
      if (now - (p.shownAt ?? now) > RESULT_SECONDS) pending.delete(id)
      else out.set(id, p.result)
      continue
    }
    const pa = prog.get(a.id)
    const pb = prog.get(b.id)
    if (stopsDone(b) > p.targetStops && settled(b) && settled(a) && pa != null && pb != null) {
      // The target has stopped and rejoined: who's ahead now?
      p.result = { target: b, margin: pa - pb, state: pa > pb ? 'worked' : 'failed' }
      p.shownAt = now
      out.set(id, p.result)
    } else if (stopsDone(b) > p.targetStops || b.inPit || !settled(a)) {
      // The target is stopping now (or just out): wait for the result rather than show a guess.
    } else if (pa != null && pb != null && now - p.since <= UNDERCUT_WINDOW_LAPS * m.lap * 2) {
      const margin = pa - (pb - lossFor(p.targetStops + 1))
      if (Math.abs(margin) > UNDERCUT_MAX) pending.delete(id)
      else if (Math.abs(margin) <= UNDERCUT_SHOW) out.set(id, { target: b, margin, state: 'pending' })
    } else {
      pending.delete(id) // the target stayed out too long: not an undercut fight any more
    }
  }
  // One attacker per target: the one that stopped last (the live fight).
  const latest = new Map<string, string>()
  for (const [id, u] of out) {
    const prev = latest.get(u.target.id)
    if (!prev || (pending.get(id)?.since ?? 0) > (pending.get(prev)?.since ?? 0)) latest.set(u.target.id, id)
  }
  for (const [id, u] of [...out]) if (latest.get(u.target.id) !== id) out.delete(id)
  return out
}
