import type { CarRow, TimingSnapshot } from './types'
import type { FeedEvent, Insight, InsightMemory } from './insights'
import type { Battle } from './battles'
import type { TowerSignals } from './towerSignals'
import { cautionPeriods, flagKind, raceLaps } from './session'
import { projectedFinish } from './championship'
import { unservedSeconds } from './penalties'
import { estimateLoss, measuredStops } from './pit/pitLoss'
import { predictRejoin, progress, progressModel } from './pit/rejoin'

/**
 * Race-strategy items for the race feed (insights.ts): what the broadcast works out by hand or guesses at, from the
 * timing data. Background: docs/PLANNING.md, "What commentators talk about" and "Race feed: strategy insights".
 * - undercuts as they happen (would the car that stopped first come out ahead?), and the result with the time gained;
 * - the order once everyone has stopped (the pit cycle), a "free" stop (enough gap to pit without losing the place);
 * - every stop of the top 10: position in and out, time in the pit lane, quickest stop so far;
 * - lapped traffic in front of the leaders, the effect of an unserved time penalty, tyre fall-off against the field,
 *   a lead wiped out by a caution, and lap times jumping across the field (conditions).
 * Pit-adjusted numbers are estimates (pit/: a stop's cost from this race's stops, else last year's).
 */

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name
const label = (c: CarRow) => `${surname(c.driver)} (#${c.carNumber})`
const secs = (x: number) => `${Math.abs(x).toFixed(1)}s`
const median = (xs: number[]) => {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Stops logged for cars in this top N going in (or the quickest stop so far): at Bathurst the top 10's were 107
 * entries, and pushed everything else out of the log's first rows. */
const STOPS_LOGGED_TOP = 6
/** A pit cycle: the top 10's latest stops all within this many laps. */
const NET_CYCLE_LAPS = 12
/** Undercut results logged only within this margin (s): the tower's pending ones show within 5 s (towerSignals). */
const UNDERCUT_RESULT_MAX = 5
/** Undercuts shown when the car that stopped first is in this top N, pit-adjusted. */
const UNDERCUT_TOP = 8
/** A stop is logged when the car first crosses a timing point after it, if that's this recent (seconds after pit exit). */
const STOP_RECENT_SECONDS = 180
/** Lapped car this close ahead on the road of a top-3 car: traffic (blue flags). An assumption, like clear air. (Top 5
 * within 2 s was up 59% of the rebuilt 2025 Gold Coast Race 29: a 70 s lap, always someone to lap.) */
const TRAFFIC_SECONDS = 1.5
/** Tyre fall-off: laps of the current stint looked at (out-lap and caution laps left out), and how much faster than
 * the field's a car's lap times must be rising (s/lap) to say so. */
const FALLOFF_LAPS = 6
const FALLOFF_EXCESS = 0.25
/** Only on a stint this long, and with the car's own laps getting slower (s/lap): early in a stint the field speeds
 * up as fuel burns off, and losing ground then isn't tyres. (At 0.15 s/lap it was up 41% of the rebuilt Race 28.) */
const FALLOFF_STINT = 10
const FALLOFF_OWN = 0.05
/** A field-wide jump in the median lap time (green laps) worth calling out: rain, a drying track. Townsville 2024:
 * ~3 s when the rain came. */
const CONDITIONS_JUMP = 2.5
/** A lead worth mentioning when a caution wipes it out. */
const LEAD_WIPED = 3

/** What the strategy items remember between updates (part of InsightMemory). */
export interface StrategyMemory {
  /** Each car's last race position on track (not in the pits), and its position when it went into its current stop. */
  lastPos: Map<string, number>
  posAtEntry: Map<string, number>
  /** Lap times per car: lap number, time, stops made, whether the lap was green throughout. */
  laps: Map<string, { lap: number; time: number; stops: number; green: boolean }[]>
  /** Median green lap time per leader lap. */
  fieldLap: Map<number, number>
  /** The lead (P2's gap) at the last green update, and as it was when each caution started. */
  lead: { leaderId: string; gap: number } | null
  leadAtCaution: Map<number, { leaderId: string; gap: number }>
}

export const newStrategyMemory = (): StrategyMemory => ({
  lastPos: new Map(), posAtEntry: new Map(), laps: new Map(), fieldLap: new Map(), lead: null, leadAtCaution: new Map(),
})

export interface StrategyContext {
  timing: TimingSnapshot
  /** Race order (raceOrder). */
  cars: CarRow[]
  memory: InsightMemory
  signals?: TowerSignals
  battles: Battle[]
  gapToLeader: (c: CarRow) => number
  onTrack: (c: CarRow) => boolean
  /** Add to the event log (once per id). */
  log: (e: Omit<FeedEvent, 'priority'>) => void
  /** The leader's lap being run, for log stamps. */
  lap: number
}

/** The "now" items, and the log events, for race strategy. */
export function strategyInsights(ctx: StrategyContext): Insight[] {
  const out: Insight[] = []
  const { timing, cars } = ctx
  const green = flagKind(timing.session.flag) === 'green'
  undercuts(ctx, out)
  netOrder(ctx, out)
  pitStops(ctx)
  if (green) {
    freeStops(ctx, out)
    traffic(ctx, out)
  }
  penaltyEffect(ctx, out)
  falloff(ctx, out, green)
  conditions(ctx, green)
  wipedLead(ctx, green)
  // Positions for the next update (where a car was when it pitted).
  cars.forEach((c, i) => { if (!c.inPit) ctx.memory.strategy.lastPos.set(c.id, i + 1) })
  return out
}

/** Undercuts in progress (now) and how they ended (log), from towerSignals. */
function undercuts({ signals, timing, cars, memory, log, lap }: StrategyContext, out: Insight[]) {
  if (!signals) return
  const pos = (c: CarRow) => cars.indexOf(c) + 1 || 99
  for (const [id, u] of signals.undercut) {
    const a = timing.cars.find((c) => c.id === id)
    if (!a) continue
    const b = u.target
    // Fights at the front only, by pit-adjusted position (where the fight really is): at Bathurst cars stop all race,
    // and the whole field's undercuts were up 65% of the time (45% by road position: a fight for P12 counted while
    // the car yet to stop was briefly in the top 10).
    if ((signals.netPosition.get(a.id) ?? pos(a)) > UNDERCUT_TOP) continue
    const net = signals.netPosition.get(a.id)
    const was = u.before >= 0 ? `stopped ${secs(u.before)} ahead` : `stopped ${secs(u.before)} behind`
    if (u.state === 'pending') {
      out.push({
        id: `undercut-${a.id}`, kind: 'undercut', tone: 'blue', priority: 70, carIds: [a.id, b.id],
        text: u.margin > 0
          ? `Undercut on: ${surname(a.driver)} would come out ${secs(u.margin)} ahead of ${surname(b.driver)} if ${surname(b.driver)} pitted now (${was}${net ? `, net P${net}` : ''})`
          : `Undercut on: ${surname(a.driver)} would be ${secs(u.margin)} short of ${surname(b.driver)} if ${surname(b.driver)} pitted now (${was}${net ? `, net P${net}` : ''})`,
      })
      continue
    }
    const key = `uc-${a.id}-${b.id}-${Math.round(u.before * 10)}`
    if (memory.logged.has(key)) continue
    memory.logged.add(key)
    // A result far beyond what was being fought over is someone's slow stop, not an undercut (Golding's 90.9 s stop
    // in the rebuilt 2025 Gold Coast Race 28 "gained" Mostert 21.7 s).
    if (Math.abs(u.margin) > UNDERCUT_RESULT_MAX) continue
    const gain = u.margin - u.before
    const gained = `${surname(a.driver)} ${gain >= 0 ? 'gained' : 'lost'} ${secs(gain)} on the stops`
    log({
      at: timing.now, lap, id: key, kind: 'undercut', tone: u.state === 'worked' ? 'green' : 'red', carIds: [a.id, b.id],
      text: u.state === 'worked'
        ? u.before < 0
          ? `Undercut worked: ${label(a)} jumped ${surname(b.driver)}, ${secs(u.margin)} ahead after both stopped (${gained}${net ? `, net P${net}` : ''})`
          : `Pitting first kept ${label(a)} ahead of ${surname(b.driver)}: ${secs(u.margin)} after both stopped (${gained})`
        : `Undercut failed: ${label(a)} pitted first, but ${surname(b.driver)} stayed ${secs(u.margin)} ahead after both stopped (${gained})`,
    })
  }
}

/** During the pit cycle: the order once everyone has made the same stops, when it isn't the order on the road. */
function netOrder({ signals, cars, timing }: StrategyContext, out: Insight[]) {
  if (!signals || signals.netPosition.size < 3) return
  // Only during a pit cycle: the top 10 split between k-1 and k stops, at least two on each side, and the k-th stops
  // recent. An old extra stop (Le Brocq's 3rd, under a caution 20 laps earlier) otherwise made every 2-stop car
  // "owe" one, and cars from the back topped the net order.
  const top = cars.slice(0, 10)
  const counts = [...new Set(top.map((c) => c.pitStops))].sort((a, b) => a - b)
  if (counts.length !== 2 || counts[1] - counts[0] !== 1) return
  const made = top.filter((c) => c.pitStops === counts[1])
  const lap = median(cars.map((c) => c.lastLap).filter((t) => t > 0)) ?? 120
  if (made.length < 2 || top.length - made.length < 2) return
  if (made.some((c) => timing.now - (c.pitLog[counts[1] - 1]?.inAt ?? 0) > NET_CYCLE_LAPS * lap)) return
  const net = [...signals.netPosition].sort((a, b) => a[1] - b[1]).slice(0, 3)
    .map(([id]) => cars.find((c) => c.id === id)).filter((c): c is CarRow => !!c)
  if (net.length < 3 || net.every((c, i) => cars[i]?.id === c.id)) return
  out.push({
    id: 'net-order', kind: 'net', tone: 'blue', priority: 66, carIds: net.map((c) => c.id),
    text: `Once the stops play out (est.): ${net.map((c, i) => `P${i + 1} ${surname(c.driver)}`).join(', ')} · on the road: ${cars.slice(0, 3).map((c) => surname(c.driver)).join(', ')}`,
  })
}

/** Each completed stop of a top-10 car: where it went in and came out, time in the pit lane, quickest so far. */
function pitStops({ timing, cars, memory, log }: StrategyContext) {
  const s = memory.strategy
  const periods = cautionPeriods(timing.flagHistory)
  const underCaution = (t: number) => periods.some((p) => t >= p.start && (p.end === undefined || t <= p.end))
  const done = timing.cars.flatMap((c) => c.pitLog.filter((p) => p.outAt > 0 && p.seconds > 0).map((p) => ({ c, p })))
  for (const c of cars) {
    const stop = c.pitLog.at(-1)
    // Going in: remember where it was (once per stop).
    if (c.inPit && stop && stop.outAt === 0) {
      const key = `${c.id}-${stop.inAt}`
      if (!s.posAtEntry.has(key) && s.lastPos.has(c.id)) s.posAtEntry.set(key, s.lastPos.get(c.id)!)
    }
    // Out and past a timing point: its place is known.
    c.pitLog.forEach((p, n) => {
      const key = `stop-${c.id}-${p.inAt}`
      if (p.outAt === 0 || memory.logged.has(key) || c.inPit || c.lastPointAt <= p.outAt || n !== c.pitLog.length - 1) return
      memory.logged.add(key)
      // Stops from before the page loaded (or a seek): their rejoin place is long gone.
      if (timing.now - p.outAt > STOP_RECENT_SECONDS) return
      const before = s.posAtEntry.get(`${c.id}-${p.inAt}`)
      const after = cars.indexOf(c) + 1
      // Green-flag stops only, and not drive-throughs: a pit-lane trip well under the usual stop (Payne's car served
      // its 32.6 s drive-through at Bathurst and came up as the quickest stop so far).
      const greenStops = done.filter((d) => d.p.inAt < p.inAt && !underCaution(d.p.inAt) && d.p.seconds > 20).map((d) => d.p.seconds)
      const usual = median(greenStops) ?? 0
      const real = (x: number) => x >= 0.75 * usual
      const quickest = !underCaution(p.inAt) && greenStops.length >= 3 && real(p.seconds) && p.seconds < Math.min(...greenStops.filter(real))
      if ((before ?? after) > STOPS_LOGGED_TOP && !quickest) return
      log({
        at: p.outAt, lap: p.lap, id: key, kind: 'pit', tone: 'blue', carIds: [c.id],
        text: `${label(c)} stop ${n + 1}: ${before ? `P${before} → ` : 'rejoined '}P${after}${p.seconds > 0 ? `, ${p.seconds.toFixed(1)}s in the pit lane` : ''}`
          + `${quickest ? ' · quickest stop so far' : ''}${underCaution(p.inAt) ? ' · under caution' : ''}`,
      })
    })
  }
}

/** A stop each car of the top 3 still has to make, that wouldn't cost it its place (the gap behind is big enough). */
function freeStops({ timing, cars, onTrack }: StrategyContext, out: Insight[]) {
  const m = progressModel(timing, [])
  if (!m) return
  const most = Math.max(0, ...cars.map((c) => c.pitStops))
  const measured = measuredStops(timing, timing.session.trackCode)
  const laps = raceLaps(timing.session)
  const lossOf = (c: CarRow) => estimateLoss(Math.max(1, c.pitLog.length), timing.session.trackCode, measured, laps).range[1]
  cars.slice(0, 3).forEach((c, i) => {
    const owes = c.pitStops < most || (most === 0 && cars[0].laps >= 5)
    if (!owes || !onTrack(c)) return
    const loss = estimateLoss(c.pitStops + 1, timing.session.trackCode, measured, laps).range
    const r = predictRejoin(timing, c, loss, m, timing.now, lossOf)
    if (!r || r.worst > i + 1) return
    const behind = cars[i + 1]
    out.push({
      id: `free-stop-${c.id}`, kind: 'freeStop', tone: 'green', priority: 45, carIds: [c.id],
      text: `${label(c)} has a free stop: would rejoin P${i + 1} even with a slow stop${behind ? ` (a stop costs ~${Math.round(loss[1])}s)` : ''}`,
    })
  })
}

/** Lapped cars just ahead on the road of a top-3 car: blue flags, time lost getting by. */
function traffic({ timing, cars, onTrack }: StrategyContext, out: Insight[]) {
  const m = progressModel(timing, [])
  if (!m) return
  const prog = new Map(cars.map((c) => [c.id, progress(c, m, timing.now, () => 0)]))
  cars.slice(0, 3).forEach((c, i) => {
    const pc = prog.get(c.id)
    if (pc == null || !onTrack(c)) return
    let near: { car: CarRow; gap: number } | null = null
    for (const o of cars) {
      const po = prog.get(o.id)
      if (o === c || po == null || !onTrack(o) || po > pc) continue // only cars behind in the race (lapped)
      const road = (((po - pc) % m.lap) + m.lap) % m.lap // seconds ahead on the road
      if (pc - po < m.lap * 0.5 || road <= 0 || road > TRAFFIC_SECONDS) continue
      if (!near || road < near.gap) near = { car: o, gap: road }
    }
    if (near) {
      out.push({
        id: `traffic-${c.id}`, kind: 'traffic', tone: 'yellow', priority: i === 0 ? 48 : 42, carIds: [c.id, near.car.id],
        text: `${label(c)}, P${i + 1}, in lapped traffic: ${surname(near.car.driver)} (P${cars.indexOf(near.car) + 1}) ${secs(near.gap)} ahead on the road`,
      })
    }
  })
}

/** An unserved time penalty: where it drops the car once added (projectedFinish adds it to the gap). */
function penaltyEffect({ timing, cars }: StrategyContext, out: Insight[]) {
  const projected = projectedFinish(timing)
  for (const c of cars) {
    const s = unservedSeconds(c, timing)
    if (s <= 0) continue
    const road = cars.indexOf(c) + 1
    const after = projected.findIndex((x) => x.id === c.id) + 1
    out.push({
      id: `penalty-effect-${c.id}`, kind: 'penaltyImpact', tone: 'red', priority: 58, carIds: [c.id],
      text: after > road
        ? `${label(c)} has +${s}s to come: P${road} on the road, P${after} with the penalty`
        : `${label(c)} has +${s}s to come: still P${road} with it (${road === 1 ? 'clear' : 'clear of the car behind'})`,
    })
  }
}

/** Lap times rising through a stint faster than the field's: tyres going off (green laps of the current stint). */
function falloff({ timing, cars, memory, onTrack }: StrategyContext, out: Insight[], green: boolean) {
  const s = memory.strategy
  const periods = cautionPeriods(timing.flagHistory)
  for (const c of cars) {
    if (c.laps < 1 || c.lastLap <= 0) continue
    const list = s.laps.get(c.id) ?? []
    if (list.at(-1)?.lap === c.laps) continue
    const start = timing.now - c.lastLap
    const clean = green && !periods.some((p) => p.start < timing.now && (p.end === undefined || p.end > start))
    list.push({ lap: c.laps, time: c.lastLap, stops: c.pitStops, green: clean && c.stintLaps >= 2 && !c.inPit })
    s.laps.set(c.id, list.slice(-30))
  }
  const slopes = new Map<string, number>()
  for (const c of cars) {
    const stint = (s.laps.get(c.id) ?? []).filter((l) => l.stops === c.pitStops && l.green).slice(-FALLOFF_LAPS)
    if (stint.length === FALLOFF_LAPS) slopes.set(c.id, slope(stint.map((l) => l.lap), stint.map((l) => l.time)))
  }
  const field = median([...slopes.values()])
  if (field === undefined || slopes.size < 5) return
  cars.slice(0, 10).forEach((c, i) => {
    const k = slopes.get(c.id)
    if (k === undefined || k - field < FALLOFF_EXCESS || k < FALLOFF_OWN || c.stintLaps < FALLOFF_STINT || !onTrack(c)) return
    out.push({
      id: `falloff-${c.id}`, kind: 'falloff', tone: 'red', priority: 38, carIds: [c.id],
      text: `${label(c)}, P${i + 1}, dropping off: losing ${(k - field).toFixed(2)}s a lap to the field over the last ${FALLOFF_LAPS} laps, ${c.stintLaps} laps into the stint`,
    })
  })
}

/** The median green lap jumping across the field from one lap to the next: rain, or a track drying. */
function conditions({ timing, cars, memory, log, onTrack }: StrategyContext, green: boolean) {
  const s = memory.strategy
  const leaderLap = cars[0].laps
  if (!green || leaderLap < 3 || s.fieldLap.has(leaderLap)) return
  // Both laps compared must be green all the way: the laps after a restart were 15-50 s "quicker" than those under it.
  const lapLen = median(cars.map((c) => c.lastLap).filter((t) => t > 0)) ?? 120
  if (cautionPeriods(timing.flagHistory).some((p) => (p.end ?? Infinity) > timing.now - 3.2 * lapLen)) return
  const times = cars.filter((c) => onTrack(c) && c.laps === leaderLap && c.stintLaps >= 2 && c.lastLap > 0).map((c) => c.lastLap)
  if (times.length < 5) return
  const now = median(times)!
  s.fieldLap.set(leaderLap, now)
  // Two laps in a row changed against the one before: rain stays, an incident (local yellows a lap before the safety
  // car, rebuilt 2025 Gold Coast Race 29: "up 5.6 s") doesn't.
  const prev = s.fieldLap.get(leaderLap - 1)
  const before = s.fieldLap.get(leaderLap - 2)
  if (prev === undefined || before === undefined || Math.abs(now - before) < CONDITIONS_JUMP || Math.abs(prev - before) < CONDITIONS_JUMP
    || Math.sign(now - before) !== Math.sign(prev - before)) return
  log({
    at: timing.now, lap: leaderLap, id: `conditions-${leaderLap}`, kind: 'conditions', tone: 'yellow', carIds: [],
    text: `Lap times ${now > before ? 'up' : 'down'} ${secs(now - before)} across the field over the last two laps: conditions changing?`,
  })
}

/** A lead of a few seconds wiped out by a caution: logged at the restart. */
function wipedLead({ timing, cars, memory, log, gapToLeader }: StrategyContext, green: boolean) {
  const s = memory.strategy
  if (green && cars[1] && cars[1].gapLaps === 0) s.lead = { leaderId: cars[0].id, gap: gapToLeader(cars[1]) }
  for (const p of cautionPeriods(timing.flagHistory)) {
    // Only for a caution seen starting (a lead remembered after the page loaded isn't the one it wiped out).
    if (!s.leadAtCaution.has(p.start) && s.lead && p.end === undefined && timing.now - p.start < 30) s.leadAtCaution.set(p.start, s.lead)
    const before = s.leadAtCaution.get(p.start)
    const key = `restart-${p.end}`
    if (p.end === undefined || !before || before.gap < LEAD_WIPED || memory.logged.has(key)) continue
    memory.logged.add(key)
    const leader = timing.cars.find((c) => c.id === before.leaderId)
    if (!leader) continue
    log({
      at: p.end, lap: cars[0].laps + 1, id: key, kind: 'caution', tone: 'yellow', carIds: [leader.id],
      text: `Restart: ${label(leader)}'s ${secs(before.gap)} lead from before the caution is gone`,
    })
  }
}

/** Least-squares slope of y over x. */
function slope(x: number[], y: number[]): number {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2 }
  return den ? num / den : 0
}
