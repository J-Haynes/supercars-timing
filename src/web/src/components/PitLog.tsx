import type { PitStopRow, TimingSnapshot } from '../types'
import { cautionPeriods } from '../session'

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name

/**
 * The same stop can be logged twice around a server restart (fixed on the server too): merge entries with the same
 * pit-in time, keeping the one that has the exit, and put them in time order.
 */
function dedupe(log: PitStopRow[]): PitStopRow[] {
  const byEntry = new Map<number, PitStopRow>()
  for (const stop of log) {
    const key = Math.round(stop.inAt)
    const seen = byEntry.get(key)
    if (!seen || (seen.outAt === 0 && stop.outAt > 0)) byEntry.set(key, stop)
  }
  return [...byEntry.values()].sort((a, b) => a.inAt - b.inAt)
}

/**
 * Pit stops across the field, most recent first: lap, car, driver swap and time in the pit lane.
 * Built from each car's `pitLog`, so it only has stops seen live (and kept across reconnects/restarts).
 */
export function PitLog({ timing, limit = 15 }: { timing: TimingSnapshot; limit?: number }) {
  const cautions = cautionPeriods(timing.flagHistory)
  const underCaution = (s: PitStopRow) => cautions.some((p) => s.inAt >= p.start && (p.end === undefined || s.inAt <= p.end))
  const stops = timing.cars
    .flatMap((car) => dedupe(car.pitLog ?? []).map((stop, i) => ({ car, stop, number: i + 1 })))
    .sort((a, b) => b.stop.inAt - a.stop.inAt)
    .slice(0, limit)

  return (
    <section className="pit-log" aria-label="Pit stops">
      <h2>Pit stops</h2>
      {stops.length === 0 ? (
        <div className="pit-log-empty">No stops yet.</div>
      ) : (
        <table>
          <tbody>
            {stops.map(({ car, stop, number }) => {
              // An unfinished stop for a car that's back on track means we missed the exit (e.g. a server restart).
              const inLane = stop.outAt === 0 && car.inPit
              const swap = stop.driverOut && stop.driverOut !== stop.driverIn
              return (
                <tr key={`${car.id}-${stop.inAt}`} className={inLane ? 'in-lane' : ''}>
                  <td className="num">L{stop.lap}</td>
                  <td><span className={`car mfr-${car.manufacturer.toLowerCase()}`}>{car.carNumber}</span></td>
                  <td className="who">
                    {swap ? <>{surname(stop.driverIn)} → <strong>{surname(stop.driverOut)}</strong></> : surname(stop.driverIn)}
                    <span className="stop-no" title="This car's stop number (stops seen live)"> · stop {number}</span>
                    {underCaution(stop) && <span className="sc-tag" title="Pitted under the safety car / FCY">SC</span>}
                  </td>
                  <td className="num">{inLane ? <span className="pit-badge">IN PIT</span> : stop.seconds > 0 ? `${stop.seconds.toFixed(1)}s` : ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
