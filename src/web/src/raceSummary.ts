import type { LapHistory, TimingSnapshot } from './types'
import { cautionPeriods } from './session'
import { startPosition } from './startingGrid'
import { carPenalties } from './penalties'

export interface RaceSummary {
  /** Laps led per driver (by the driver in the car on each lap they led), most first. */
  lapsLed: { carNumber: string; driver: string; laps: number }[]
  leadChanges: number
  cautions: { start: number; end?: number; laps?: number }[]
  /** From the first green flag to the chequered flag, seconds. */
  raceSeconds?: number
  movers: { carNumber: string; driver: string; start: number; finish: number; change: number }[]
  fastestStop?: { carNumber: string; driver: string; seconds: number; lap: number }
  penalties: { carNumber: string; driver: string; what: string; served: boolean }[]
  retirements: { carNumber: string; driver: string; laps: number }[]
}

/**
 * A race's story from its final snapshot and lap history: laps led, lead changes, safety cars, race time, biggest
 * movers from the grid, fastest pit stop, penalties and cars that didn't finish.
 */
export function raceSummary(results: TimingSnapshot, history: LapHistory | null): RaceSummary {
  const nameOf = (carId: string, index: string) => {
    const car = history?.cars.find((c) => c.id === carId)
    const i = Number(index) - 1
    return car?.drivers[i] || car?.driver || ''
  }

  // Laps led: the car at P1 at the end of each lap, credited to its driver on that lap.
  const led = new Map<string, { carNumber: string; driver: string; laps: number }>()
  const leaderByLap = new Map<number, string>()
  for (const car of history?.cars ?? []) {
    for (const l of car.laps) {
      if (l.position !== 1) continue
      leaderByLap.set(l.lap, car.id)
      const driver = nameOf(car.id, l.driver)
      const key = `${car.carNumber}|${driver}`
      const entry = led.get(key) ?? { carNumber: car.carNumber, driver, laps: 0 }
      entry.laps++
      led.set(key, entry)
    }
  }
  const leaders = [...leaderByLap.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id)
  const leadChanges = leaders.filter((id, i) => i > 0 && id !== leaders[i - 1]).length

  // Safety cars, with laps under each counted from the leader's lap entries.
  const leaderLapTimes = (history?.cars ?? []).flatMap((c) => c.laps.filter((l) => l.position === 1).map((l) => l.at)).sort((a, b) => a - b)
  const cautions = cautionPeriods(results.flagHistory).map((p) => ({
    ...p,
    laps: p.end ? leaderLapTimes.filter((t) => t >= p.start && t <= p.end!).length : undefined,
  }))

  const checkered = results.flagHistory?.find((f) => /check/i.test(f.flag))?.time
  const raceSeconds = results.session.greenAt && checkered ? checkered - results.session.greenAt : undefined

  const classified = [...results.cars].filter((c) => c.position > 0).sort((a, b) => a.position - b.position)
  const movers = classified
    .map((c) => ({ c, start: startPosition(results.session, c) ?? 0 }))
    .filter((x) => x.start > 0)
    .map(({ c, start }) => ({ carNumber: c.carNumber, driver: c.driver, start, finish: c.position, change: start - c.position }))
    .sort((a, b) => b.change - a.change)

  let fastestStop: RaceSummary['fastestStop']
  for (const c of results.cars) {
    for (const p of c.pitLog ?? []) {
      if (p.seconds > 20 && (!fastestStop || p.seconds < fastestStop.seconds)) fastestStop = { carNumber: c.carNumber, driver: p.driverIn || c.driver, seconds: p.seconds, lap: p.lap }
    }
  }

  const penalties = results.cars.flatMap((c) => carPenalties(c, results).map((p) => ({ carNumber: c.carNumber, driver: c.driver, what: p.what, served: !!p.servedAt })))
  const winnerLaps = classified[0]?.laps ?? 0
  const retirements = classified.filter((c) => winnerLaps > 0 && c.laps < winnerLaps - 5).map((c) => ({ carNumber: c.carNumber, driver: c.driver, laps: c.laps }))

  return { lapsLed: [...led.values()].sort((a, b) => b.laps - a.laps), leadChanges, cautions, raceSeconds, movers, fastestStop, penalties, retirements }
}
