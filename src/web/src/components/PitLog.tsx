import type { TimingSnapshot } from '../types'

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name

/**
 * Pit stops across the field, most recent first: lap, car, driver swap and time in the pit lane.
 * Built from each car's `pitLog`, so it only has stops seen live (and kept across reconnects/restarts).
 */
export function PitLog({ timing, limit = 15 }: { timing: TimingSnapshot; limit?: number }) {
  const stops = timing.cars
    .flatMap((car) => (car.pitLog ?? []).map((stop, i) => ({ car, stop, number: i + 1 })))
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
              const inLane = stop.outAt === 0
              const swap = stop.driverOut && stop.driverOut !== stop.driverIn
              return (
                <tr key={`${car.id}-${stop.inAt}`} className={inLane ? 'in-lane' : ''}>
                  <td className="num">L{stop.lap}</td>
                  <td><span className={`car mfr-${car.manufacturer.toLowerCase()}`}>{car.carNumber}</span></td>
                  <td className="who">
                    {swap ? <>{surname(stop.driverIn)} → <strong>{surname(stop.driverOut)}</strong></> : surname(stop.driverIn)}
                    <span className="stop-no" title="This car's stop number (stops seen live)"> · stop {number}</span>
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
