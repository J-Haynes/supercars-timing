import type { CarRow, TimingSnapshot } from './types'
import { liveGap, parkedAtLine, raceOrder } from './liveGaps'
import { startPosition } from './startingGrid'
import { cautionPeriods, minDriverLaps, raceLaps } from './session'
import { lapTime } from './format'

/** One item in the insights ticker. `carIds` are highlighted in the tower and on the map on hover. */
export interface Insight {
  id: string
  kind: 'fastest' | 'lead' | 'penalty' | 'control' | 'caution' | 'battle' | 'closing' | 'minLaps' | 'mover' | 'longRun'
  text: string
  carIds: string[]
  tone: 'purple' | 'green' | 'red' | 'yellow' | 'blue' | 'plain'
}

/** Events remembered between updates (new fastest lap, lead changes) and lap-by-lap intervals for trends. */
export interface InsightMemory {
  bestLap: number
  leaderId: string
  events: { at: number; insight: Insight }[]
  /** Per car: interval to the car ahead at each line crossing, newest last. */
  intervals: Map<string, { laps: number; aheadId: string; interval: number }[]>
}

export const newMemory = (): InsightMemory => ({ bestLap: 0, leaderId: '', events: [], intervals: new Map() })

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name
const label = (c: CarRow) => `${surname(c.driver)} (#${c.carNumber})`
const median = (xs: number[]) => {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** Events stay in the ticker this long (Natsoft seconds). */
const EVENT_SECONDS = 180
/** Cars this close on the road are battling. */
const BATTLE_SECONDS = 1.0
/** Places gained/lost (pit-adjusted) to count as a big mover. */
const MOVER_PLACES = 5

/**
 * Insights for the ticker, races only. Pure apart from `memory`, which it updates (events and interval history).
 * Order: recent events first, then battles, trends, minimum laps, movers, strategy.
 */
export function buildInsights(timing: TimingSnapshot, memory: InsightMemory): Insight[] {
  const order = ['M', ...timing.timingPoints.map((p) => p.id)]
  const cars = raceOrder(timing)
  if (cars.length === 0) return []
  const now = timing.now
  const leader = cars[0]
  const byNumber = new Map(cars.map((c) => [c.carNumber, c]))
  const onTrack = (c: CarRow) => !c.inPit && !parkedAtLine(c)
  const gapToLeader = (c: CarRow) => (c === leader ? 0 : liveGap(c, leader, order) ?? (c.liveGapLaps === 0 && c.liveGap > 0 ? c.liveGap : c.gap))

  remember(timing, cars, memory, now, order)
  const out: Insight[] = memory.events.filter((e) => now - e.at < EVENT_SECONDS).map((e) => e.insight).reverse()

  // Safety car / FCY: while it's out (and for a few minutes after), plus who pitted under it (a cheaper stop).
  const periods = cautionPeriods(timing.flagHistory)
  const last = periods[periods.length - 1]
  if (last && (last.end === undefined || now - last.end < EVENT_SECONDS)) {
    const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
    out.unshift(last.end === undefined
      ? { id: `caution-${last.start}`, kind: 'caution', tone: 'yellow', carIds: [], text: `Safety car / full course yellow (caution #${periods.length})` }
      : { id: `green-${last.end}`, kind: 'caution', tone: 'green', carIds: [], text: `Back to green after ${mins(last.end - last.start)} under caution` })
    const pitted = cars.filter((c) => (c.pitLog ?? []).some((p) => p.inAt >= last.start && (last.end === undefined || p.inAt <= last.end)))
    if (pitted.length > 0) {
      out.push({ id: `caution-pits-${last.start}`, kind: 'caution', tone: 'yellow', carIds: pitted.map((c) => c.id),
        text: `Pitted under caution: ${pitted.map((c) => surname(c.driver)).join(', ')}` })
    }
  }

  // Race control: penalties and incidents in the last few minutes, with the cars they name.
  for (const m of timing.raceControl ?? []) {
    if (now - m.time > EVENT_SECONDS) break // newest first
    const named = [...m.text.matchAll(/(?:\bcars?|&|-|,)\s*(\d{1,3})\b(?!\s*sec)/gi)].map((x) => byNumber.get(x[1])).filter((c): c is CarRow => !!c)
    const penalty = /penalty/i.test(m.text)
    out.push({
      id: `rc-${m.time}`, kind: penalty ? 'penalty' : 'control', tone: penalty ? 'red' : 'yellow',
      text: m.text.replace(/^(Race Control|Stewards):\s*/i, penalty ? 'Penalty: ' : 'Race control: ').replace(/^Penalty: Penalty /i, 'Penalty: '),
      carIds: [...new Set(named.map((c) => c.id))],
    })
  }

  // Close battles: consecutive cars on the road within a second, same lap. Chains of 3+ are a train.
  let chain: CarRow[] = []
  let spread = 0 // sum of the intervals that put the cars in the chain, so the text matches the 1 s test
  const flush = () => {
    if (chain.length >= 2) {
      const first = cars.indexOf(chain[0]) + 1
      const last = first + chain.length - 1
      out.push(chain.length === 2
        ? { id: `battle-${chain.map((c) => c.id).join('-')}`, kind: 'battle', tone: 'yellow', carIds: chain.map((c) => c.id),
            text: `Battle for P${first}: ${label(chain[1])} ${spread.toFixed(2)}s behind ${label(chain[0])}` }
        : { id: `battle-${chain.map((c) => c.id).join('-')}`, kind: 'battle', tone: 'yellow', carIds: chain.map((c) => c.id),
            text: `P${first}–P${last} covered by ${spread.toFixed(1)}s: ${chain.map((c) => surname(c.driver)).join(', ')}` })
    }
    chain = []
    spread = 0
  }
  for (let i = 1; i < cars.length; i++) {
    const a = cars[i - 1], b = cars[i]
    const interval = onTrack(a) && onTrack(b) && b.laps === a.laps ? liveGap(b, a, order) : null
    if (interval !== null && interval < BATTLE_SECONDS) {
      if (chain.length === 0) chain.push(a)
      chain.push(b)
      spread += interval
    } else flush()
  }
  flush()

  // Closing in: the interval to the same car ahead has shrunk at each of the last 3 line crossings.
  for (const c of cars) {
    const h = memory.intervals.get(c.id) ?? []
    const last = h.slice(-4)
    if (last.length < 4 || !onTrack(c) || last.some((x) => x.aheadId !== last[0].aheadId)) continue
    const shrinking = last.every((x, i) => i === 0 || x.interval < last[i - 1].interval)
    const ahead = timing.cars.find((x) => x.id === last[0].aheadId)
    const drop = last[0].interval - last[3].interval
    if (shrinking && ahead && drop >= 0.5 && last[3].interval < 3) {
      out.push({ id: `closing-${c.id}`, kind: 'closing', tone: 'green', carIds: [c.id, ahead.id],
        text: `${label(c)} closing on ${label(ahead)}: ${last[0].interval.toFixed(1)}s → ${last[3].interval.toFixed(1)}s in 3 laps` })
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
        out.push({ id: `min-${c.id}-${i}`, kind: 'minLaps', tone: 'red', carIds: [c.id],
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
      .filter((c) => startPosition(timing.session, c.carNumber))
      .map((c) => ({ c, t: gapToLeader(c) + c.gapLaps * typicalLap + (maxStops - c.pitStops) * pitLoss }))
      .sort((a, b) => a.t - b.t)
    adjusted.forEach(({ c }, i) => {
      const start = startPosition(timing.session, c.carNumber) ?? 0
      const change = start - (i + 1)
      if (Math.abs(change) < MOVER_PLACES || !onTrack(c)) return
      out.push(change > 0
        ? { id: `mover-${c.id}`, kind: 'mover', tone: 'green', carIds: [c.id], text: `Big mover: ${label(c)} up ${change} places since the start (pit-adjusted)` }
        : { id: `mover-${c.id}`, kind: 'mover', tone: 'red', carIds: [c.id], text: `${label(c)} down ${-change} places since the start (pit-adjusted)` })
    })

    // Running long: cars that have made fewer stops than most of the field.
    const usual = median(cars.map((c) => c.pitStops)) ?? 0
    const long = cars.filter((c) => c.pitStops < usual && onTrack(c))
    if (long.length > 0 && long.length <= 8) {
      out.push({ id: 'long-run', kind: 'longRun', tone: 'blue', carIds: long.map((c) => c.id),
        text: `Still to make stop ${usual}: ${long.map((c) => `${surname(c.driver)} (${c.stintLaps} laps on this stint)`).join(', ')}` })
    }
  }

  // Current fastest lap (the "new fastest lap" event covers changes).
  const fastest = cars.find((c) => timing.best.lap && Math.abs(c.bestLap - timing.best.lap) < 0.0005)
  if (fastest && !out.some((i) => i.kind === 'fastest')) {
    out.push({ id: 'fastest-now', kind: 'fastest', tone: 'purple', carIds: [fastest.id],
      text: `Fastest lap: ${label(fastest)} ${lapTime(fastest.bestLap)}${fastest.bestLapNo ? ` on lap ${fastest.bestLapNo}` : ''}` })
  }
  return out
}

/** Update events (new fastest lap, lead change) and the per-lap interval history. */
function remember(timing: TimingSnapshot, cars: CarRow[], memory: InsightMemory, now: number, order: string[]) {
  const best = timing.best.lap ?? 0
  if (best > 0 && memory.bestLap > 0 && best < memory.bestLap - 0.0005) {
    const c = cars.find((x) => Math.abs(x.bestLap - best) < 0.0005)
    if (c) memory.events.push({ at: now, insight: { id: `fastest-${best}`, kind: 'fastest', tone: 'purple', carIds: [c.id],
      text: `New fastest lap: ${label(c)} ${lapTime(best)}${c.bestLapNo ? ` on lap ${c.bestLapNo}` : ''}` } })
  }
  if (best > 0) memory.bestLap = best

  const leader = cars[0]
  if (memory.leaderId && leader.id !== memory.leaderId) {
    const old = timing.cars.find((c) => c.id === memory.leaderId)
    memory.events.push({ at: now, insight: { id: `lead-${leader.id}-${now}`, kind: 'lead', tone: 'green', carIds: [leader.id, ...(old ? [old.id] : [])],
      text: old?.inPit || (old && parkedAtLine(old)) ? `${label(leader)} leads as ${surname(old.driver)} pits` : `New leader: ${label(leader)}` } })
  }
  memory.leaderId = leader.id
  memory.events = memory.events.filter((e) => now - e.at < EVENT_SECONDS)

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
}
