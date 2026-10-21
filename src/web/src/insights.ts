import type { CarRow, TimingSnapshot } from './types'
import { notableBattles, type Battle } from './battles'
import { liveGap, parkedAtLine, raceOrder } from './liveGaps'
import { startPosition } from './startingGrid'
import { cautionPeriods, flagKind, minDriverLaps, raceLaps } from './session'
import { lapTime } from './format'
import { isF1 } from './series'
import type { TowerSignals } from './towerSignals'
import { newStrategyMemory, strategyInsights, type StrategyMemory } from './strategyInsights'

/** One item in the race feed. `carIds` are highlighted in the tower and on the map on hover. */
export interface Insight {
  id: string
  kind: 'fastest' | 'lead' | 'penalty' | 'control' | 'caution' | 'battle' | 'closing' | 'minLaps' | 'mover' | 'longRun' | 'pace' | 'spread'
    | 'undercut' | 'net' | 'pit' | 'freeStop' | 'traffic' | 'penaltyImpact' | 'falloff' | 'conditions'
  text: string
  carIds: string[]
  /** The item's rail colour. Yellow is cautions only; cyan battles (as on the map and tower); blue strategy. */
  tone: 'purple' | 'green' | 'red' | 'yellow' | 'blue' | 'cyan' | 'plain'
  /** Higher shows first among the "now" items (situations). */
  priority: number
}

/** Something that happened, in the feed's log: newest first. */
export interface FeedEvent extends Insight {
  /** Natsoft time it happened (track-local wall clock). */
  at: number
  /** The leader's lap at the time (the lap being run), when we saw it happen; 0 for messages from before page load. */
  lap: number
}

/** What the race feed shows: the log of events, and what's going on now, most important first. */
export interface Feed {
  events: FeedEvent[]
  now: Insight[]
}

/** Remembered between updates: the event log, lap-by-lap intervals for trends, and how long battles have lasted. */
export interface InsightMemory {
  bestLap: number
  leaderId: string
  events: FeedEvent[]
  /** Race control messages and caution periods already in the log (by time). */
  logged: Set<string>
  /** Per car: interval to the car ahead at each line crossing, newest last. */
  intervals: Map<string, { laps: number; aheadId: string; interval: number }[]>
  /** Per pair of cars (front id, behind id): when they were first seen battling, while they still are. */
  battleSince: Map<string, number>
  /** Race strategy items (strategyInsights.ts). */
  strategy: StrategyMemory
}

export const newMemory = (): InsightMemory => ({
  bestLap: 0, leaderId: '', events: [], logged: new Set(), intervals: new Map(), battleSince: new Map(), strategy: newStrategyMemory(),
})

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name
const label = (c: CarRow) => `${surname(c.driver)} (#${c.carNumber})`
const median = (xs: number[]) => {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Events kept in the log (pit stops of the top 10 are logged too). */
const LOG_SIZE = 150
/** "Pitted under caution" and "back to green" stay in the now list this long after a caution (Natsoft seconds). */
const AFTER_CAUTION_SECONDS = 180
/** A battle shows in the feed once the same two cars have been battling this long (passing a lapped car isn't one). */
const BATTLE_SETTLE_SECONDS = 20
/** Battles shown at once in the feed, front of the field first (the map shows them all). */
const MAX_BATTLES = 3
/** Places gained/lost (pit-adjusted) to count as a big mover. */
const MOVER_PLACES = 5
/** A difference in laps since the last stop (or tyre age, F1) worth mentioning in a battle. */
const STINT_OFFSET_LAPS = 5

/**
 * The race feed, races only. Pure apart from `memory`, which it updates (the event log, interval history, battles).
 * Ideas from commentary on full races (docs/PLANNING.md, "What commentators talk about"): who's fastest on track,
 * tyre age offsets in a battle, the spread across the top cars.
 */
export function buildFeed(timing: TimingSnapshot, memory: InsightMemory, signals?: TowerSignals): Feed {
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const cars = raceOrder(timing)
  if (cars.length === 0) return { events: [], now: [] }
  const now = timing.now
  const leader = cars[0]
  const green = flagKind(timing.session.flag) === 'green'
  const onTrack = (c: CarRow) => !c.inPit && !parkedAtLine(c) && !c.retired
  const gapToLeader = (c: CarRow) => (c === leader ? 0 : liveGap(c, leader, order) ?? (c.liveGapLaps === 0 && c.liveGap > 0 ? c.liveGap : c.gap))

  const battleList = notableBattles(timing)
  remember(timing, cars, memory, now, order, battleList)
  const out: Insight[] = []
  const typicalLap = median(cars.map((c) => c.lastLap).filter((t) => t > 0)) ?? 120

  // Who pitted under the latest caution (a cheaper stop), while it's out and for a few minutes after.
  const periods = cautionPeriods(timing.flagHistory)
  const last = periods[periods.length - 1]
  if (last && (last.end === undefined || now - last.end < AFTER_CAUTION_SECONDS)) {
    const pitted = cars.filter((c) => (c.pitLog ?? []).some((p) => p.inAt >= last.start && (last.end === undefined || p.inAt <= last.end)))
    if (pitted.length > 0) {
      out.push({ id: `caution-pits-${last.start}`, kind: 'caution', tone: 'yellow', priority: 75, carIds: pitted.map((c) => c.id),
        text: `Pitted under caution (${pitted.length}): ${pitted.map((c) => surname(c.driver)).join(', ')}` })
    }
  }

  // Battles: notableBattles (none under a caution or just after a restart, packs split up), settled for a few
  // seconds, front of the field first. Each says how far apart they are on stint/tyre age when that's large.
  const settled = battleList.filter((b) => {
    const since = memory.battleSince.get(`${b.cars[0].id}>${b.cars[1].id}`)
    return since !== undefined && now - since >= BATTLE_SETTLE_SECONDS
  })
  settled.slice(0, MAX_BATTLES).forEach((battle, n) => {
    const chain = battle.cars
    const first = battle.position
    const lastPos = first + chain.length - 1
    // How long it has gone on: "they've been nose to tail for 6 laps".
    const since = memory.battleSince.get(`${chain[0].id}>${chain[1].id}`) ?? now
    const laps = Math.floor((now - since) / typicalLap)
    const offset = (chain.length === 2 ? stintOffset(chain[0], chain[1]) : '') + (laps >= 2 ? ` · ${laps} laps` : '')
    out.push({
      id: `battle-${chain.map((c) => c.id).join('-')}`, kind: 'battle', tone: 'cyan', carIds: chain.map((c) => c.id),
      // Battles for the lead and the podium matter most.
      priority: (first <= 3 ? 65 : 50) - n,
      text: chain.length === 2
        ? `P${first}: ${surname(chain[1].driver)} ${battle.spread.toFixed(1)}s behind ${surname(chain[0].driver)}${offset}`
        : `P${first}–P${lastPos} within ${battle.spread.toFixed(1)}s: ${chain.map((c) => surname(c.driver)).join(', ')}`,
    })
  })
  if (settled.length > MAX_BATTLES) {
    const rest = settled.slice(MAX_BATTLES)
    out.push({ id: 'battles-more', kind: 'battle', tone: 'plain', priority: 10, carIds: rest.flatMap((b) => b.cars.map((c) => c.id)),
      text: `${rest.length} more ${rest.length === 1 ? 'battle' : 'battles'} further back: ${rest.map((b) => `P${b.position}`).join(', ')}` })
  }

  // Closing in: the interval to the same car ahead has shrunk at each of the last 3 line crossings.
  if (green) {
    for (const c of cars) {
      const h = memory.intervals.get(c.id) ?? []
      const recent = h.slice(-4)
      if (recent.length < 4 || !onTrack(c) || recent.some((x) => x.aheadId !== recent[0].aheadId)) continue
      const shrinking = recent.every((x, i) => i === 0 || x.interval < recent[i - 1].interval)
      const ahead = timing.cars.find((x) => x.id === recent[0].aheadId)
      const drop = recent[0].interval - recent[3].interval
      if (shrinking && ahead && drop >= 0.5 && recent[3].interval < 3) {
        // At this rate, within a second of the car ahead in this many laps.
        const perLap = drop / 3
        const eta = recent[3].interval > 1 ? Math.ceil((recent[3].interval - 1) / perLap) : 0
        const when = eta > 0 && eta <= 10 ? ` · within a second in ~${eta} ${eta === 1 ? 'lap' : 'laps'}` : ''
        // A third car catching a fight: the car ahead is the back of a battle (commentators: "the beneficiary").
        const fight = settled.find((b) => b.cars.at(-1)?.id === ahead.id && !b.cars.some((x) => x.id === c.id))
        out.push({ id: `closing-${c.id}`, kind: 'closing', tone: 'green', priority: fight ? 57 : 55, carIds: [c.id, ...(fight ? fight.cars.map((x) => x.id) : [ahead.id])],
          text: fight
            ? `${surname(c.driver)} closing on the ${fight.cars.map((x) => surname(x.driver)).join('–')} fight: ${recent[3].interval.toFixed(1)}s back, ${perLap.toFixed(1)}s a lap${when}`
            : `${surname(c.driver)} closing on ${surname(ahead.driver)}: ${recent[0].interval.toFixed(1)}s → ${recent[3].interval.toFixed(1)}s in 3 laps${when}` })
      }
    }
  }

  // Fastest on track: the quickest last lap among cars on the lead lap and on track, as commentators read it out
  // each lap ("the fastest car on the track last lap"). Green only, and only when it stands out (0.2 s+).
  if (green && leader.laps >= 3) {
    const laps = cars.filter((c) => onTrack(c) && c.lastLap > 0).sort((a, b) => a.lastLap - b.lastLap)
    if (laps.length >= 2 && laps[1].lastLap - laps[0].lastLap >= 0.2) {
      const c = laps[0]
      const pos = cars.indexOf(c) + 1
      out.push({ id: `pace-${c.id}`, kind: 'pace', tone: 'purple', priority: 35, carIds: [c.id],
        text: `Fastest on track last lap: ${surname(c.driver)} (P${pos}) ${lapTime(c.lastLap)}, ${(laps[1].lastLap - c.lastLap).toFixed(1)}s up on anyone` })
    }
  }

  // Minimum laps per driver (endurance races): drivers who can't, or only just can, still reach it.
  const minLaps = minDriverLaps(timing.session)
  const total = raceLaps(timing.session)
  if (minLaps > 0 && total > 0) {
    const lapsLeft = Math.max(0, total - leader.laps)
    for (const c of cars.filter((x) => x.drivers.length > 1)) {
      c.drivers.forEach((name, i) => {
        const needed = minLaps - (c.driverLaps?.[i] ?? 0)
        const margin = lapsLeft - needed
        if (needed <= 0 || margin > 15) return
        out.push({ id: `min-${c.id}-${i}`, kind: 'minLaps', tone: 'red', carIds: [c.id], priority: margin < 0 ? 90 : 60,
          text: margin < 0
            ? `${surname(name)} (#${c.carNumber}) can't reach ${minLaps} laps: needs ${needed}, ${lapsLeft} left`
            : `${surname(name)} (#${c.carNumber}) needs ${needed} of the last ${lapsLeft} laps for the ${minLaps}-lap minimum` })
      })
    }
  }

  // Big movers, pit-adjusted: a car that has made fewer stops than the field gets the typical stop's time loss
  // added for each stop it still owes, so it isn't a "mover" just for not having stopped yet.
  if (leader.laps >= 5) {
    const pitSeconds = cars.flatMap((c) => (c.pitLog ?? []).map((p) => p.seconds).filter((s) => s > 20 && s < 180))
    // Loss per stop: time in the pit lane minus the ~10 s the car would have taken on track over that stretch.
    const pitLoss = (median(pitSeconds) ?? 65) - 10
    const maxStops = Math.max(...cars.map((c) => c.pitStops))
    const typicalLap = median(cars.map((c) => c.lastLap).filter((t) => t > 0)) ?? 130
    const adjusted = cars
      .filter((c) => startPosition(timing.session, c))
      .map((c) => ({ c, t: gapToLeader(c) + c.gapLaps * typicalLap + (maxStops - c.pitStops) * pitLoss }))
      .sort((a, b) => a.t - b.t)
    adjusted.forEach(({ c }, i) => {
      const start = startPosition(timing.session, c) ?? 0
      const change = start - (i + 1)
      if (Math.abs(change) < MOVER_PLACES || !onTrack(c)) return
      out.push(change > 0
        ? { id: `mover-${c.id}`, kind: 'mover', tone: 'green', priority: 25, carIds: [c.id], text: `${label(c)} up ${change} places since the start (pit-adjusted)` }
        : { id: `mover-${c.id}`, kind: 'mover', tone: 'red', priority: 24, carIds: [c.id], text: `${label(c)} down ${-change} places since the start (pit-adjusted)` })
    })

    // Running long: cars that have made fewer stops than most of the field.
    const usual = median(cars.map((c) => c.pitStops)) ?? 0
    const long = cars.filter((c) => c.pitStops < usual && onTrack(c))
    if (long.length > 0 && long.length <= 8) {
      out.push({ id: 'long-run', kind: 'longRun', tone: 'blue', priority: 40, carIds: long.map((c) => c.id),
        text: `Still to make stop ${usual}: ${long.map((c) => `${surname(c.driver)} (${c.stintLaps} laps on this stint)`).join(', ')}` })
    }
  }

  // Spread across the top cars ("6 seconds covers the top six"): only when it's tight enough to be a story.
  if (green && leader.laps >= 3) {
    for (const n of [10, 6, 3]) {
      const top = cars.slice(0, n)
      if (top.length < n || top.some((c) => !onTrack(c) || c.gapLaps > 0)) continue
      const spread = gapToLeader(top[n - 1])
      if (spread > 0 && spread <= n * 1.2) {
        out.push({ id: `spread-${n}`, kind: 'spread', tone: 'plain', priority: 20, carIds: top.map((c) => c.id),
          text: `Top ${n} covered by ${spread.toFixed(1)}s` })
        break
      }
    }
  }

  // Race strategy: undercuts, the order after the stops, pit stops, free stops, traffic, penalties, fall-off...
  const log = (e: Omit<FeedEvent, 'priority'>) => memory.events.push({ ...e, priority: 0 })
  out.push(...strategyInsights({ timing, cars, memory, signals, battles: battleList, gapToLeader, onTrack, log, lap: leader.laps + 1 }))
  memory.events.sort((a, b) => a.at - b.at)
  memory.events = memory.events.slice(-LOG_SIZE)

  return { events: [...memory.events].reverse(), now: out.sort((a, b) => b.priority - a.priority) }
}

/** " · stint 18 vs 4 laps" (Supercars: laps since the last stop) or " · tyres M 20 vs S 4" (F1), when far apart. */
function stintOffset(ahead: CarRow, behind: CarRow): string {
  if (isF1) {
    const [a, b] = [ahead.tyreLaps ?? 0, behind.tyreLaps ?? 0]
    if (!ahead.tyre || !behind.tyre || Math.abs(a - b) < STINT_OFFSET_LAPS) return ''
    return ` · tyres ${ahead.tyre[0]} ${a} vs ${behind.tyre[0]} ${b}`
  }
  if (Math.abs(ahead.stintLaps - behind.stintLaps) < STINT_OFFSET_LAPS || ahead.pitStops === 0 && behind.pitStops === 0) return ''
  return ` · stint ${ahead.stintLaps} vs ${behind.stintLaps} laps`
}

/** Update the event log (fastest laps, lead changes, race control, cautions), interval history and battle ages. */
function remember(timing: TimingSnapshot, cars: CarRow[], memory: InsightMemory, now: number, order: string[], battleList: Battle[]) {
  const leader = cars[0]
  const lap = leader.laps + 1
  const log = (e: Omit<FeedEvent, 'priority'>) => memory.events.push({ ...e, priority: 0 })

  const best = timing.best.lap ?? 0
  if (best > 0 && memory.bestLap > 0 && best < memory.bestLap - 0.0005) {
    const c = cars.find((x) => Math.abs(x.bestLap - best) < 0.0005)
    if (c) log({ at: now, lap, id: `fastest-${best}`, kind: 'fastest', tone: 'purple', carIds: [c.id],
      text: `Fastest lap: ${label(c)} ${lapTime(best)}` })
  }
  if (best > 0) memory.bestLap = best

  if (memory.leaderId && leader.id !== memory.leaderId) {
    const old = timing.cars.find((c) => c.id === memory.leaderId)
    log({ at: now, lap, id: `lead-${leader.id}-${now}`, kind: 'lead', tone: 'green', carIds: [leader.id, ...(old ? [old.id] : [])],
      text: old?.inPit || (old && parkedAtLine(old)) ? `${label(leader)} leads as ${surname(old.driver)} pits` : `New leader: ${label(leader)}` })
  }
  memory.leaderId = leader.id

  // Cautions and restarts. Ones from before the page loaded are logged too, without a lap.
  const fresh = (t: number) => (now - t < 30 ? lap : 0)
  cautionPeriods(timing.flagHistory).forEach((p, i) => {
    if (!memory.logged.has(`c${p.start}`)) {
      memory.logged.add(`c${p.start}`)
      log({ at: p.start, lap: fresh(p.start), id: `caution-${p.start}`, kind: 'caution', tone: 'yellow', carIds: [],
        text: `${isF1 ? 'Safety car / VSC' : 'Safety car'} (caution #${i + 1})` })
    }
    if (p.end !== undefined && !memory.logged.has(`g${p.end}`)) {
      memory.logged.add(`g${p.end}`)
      const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
      log({ at: p.end, lap: fresh(p.end), id: `green-${p.end}`, kind: 'caution', tone: 'green', carIds: [], text: `Green again after ${mins(p.end - p.start)} under caution` })
    }
  })

  // Race control: penalties and incidents, with the cars they name. Oldest first so the log stays in order.
  const byNumber = new Map(cars.map((c) => [c.carNumber, c]))
  for (const m of [...(timing.raceControl ?? [])].reverse()) {
    const key = `rc${m.time}|${m.text}`
    if (memory.logged.has(key)) continue
    memory.logged.add(key)
    const named = [...m.text.matchAll(/(?:\bcars?|&|-|,)\s*(\d{1,3})\b(?!\s*sec)/gi)].map((x) => byNumber.get(x[1])).filter((c): c is CarRow => !!c)
    const penalty = /penalty/i.test(m.text)
    log({
      at: m.time, lap: fresh(m.time), id: `rc-${m.time}-${memory.events.length}`, kind: penalty ? 'penalty' : 'control', tone: penalty ? 'red' : 'plain',
      text: m.text.replace(/^(Race Control|Stewards):\s*/i, penalty ? 'Penalty: ' : '').replace(/^Penalty: Penalty /i, 'Penalty: '),
      carIds: [...new Set(named.map((c) => c.id))],
    })
  }
  memory.events.sort((a, b) => a.at - b.at)
  memory.events = memory.events.slice(-LOG_SIZE)

  // Interval to the car ahead each time a car completes a lap (at the line, where gaps are exact).
  cars.forEach((c, i) => {
    if (i === 0 || c.lastPoint !== 'M' || !c.lapStartAt) return
    const h = memory.intervals.get(c.id) ?? []
    if (h.length && h[h.length - 1].laps === c.laps) return
    const ahead = cars[i - 1]
    const interval = liveGap(c, ahead, order)
    if (interval === null) return
    h.push({ laps: c.laps, aheadId: ahead.id, interval })
    memory.intervals.set(c.id, h.slice(-6))
  })

  // How long each pair has been battling: pairs that aren't any more are forgotten.
  const pairs = new Set(battleList.flatMap((b) => b.cars.slice(1).map((c, i) => `${b.cars[i].id}>${c.id}`)))
  for (const key of [...memory.battleSince.keys()]) if (!pairs.has(key)) memory.battleSince.delete(key)
  for (const key of pairs) if (!memory.battleSince.has(key)) memory.battleSince.set(key, now)
}
