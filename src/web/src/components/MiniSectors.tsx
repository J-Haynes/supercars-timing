import type { CarRow } from '../types'

/**
 * F1-style mini-sectors for one car: a block per stretch between timing points. Purple = fastest of anyone
 * this session, green = the car's personal best, yellow = slower. Stretches not yet reached on this lap show
 * the previous lap's colour, faded. The stretch the car is in now is outlined. Outside races an out-lap isn't
 * shown (it isn't a timed lap; in the Shootout it lit up the tower while the On-track card waited for the flying lap).
 */
export function MiniSectors({ car, order, sessionBest, race }: { car: CarRow; order: string[]; sessionBest: number[]; race: boolean }) {
  const outLap = !race && !car.inPit && car.lapsSincePit === 0
  const current = outLap ? [] : car.currentSegments ?? []
  const last = car.lastLapSegments ?? []
  const best = car.bestSegments ?? []
  const active = car.inPit ? -1 : order.indexOf(car.lastPoint)

  return (
    <div className={`minis${car.inPit ? ' in-pit' : ''}`} aria-label="Micro-sectors">
      {order.map((id, i) => {
        const thisLap = current[i] > 0
        const t = thisLap ? current[i] : last[i]
        const colour = !(t > 0) ? '' : t <= (sessionBest[i] || 0) + 0.0005 ? 'purple' : t <= (best[i] || 0) + 0.0005 ? 'green' : 'yellow'
        const classes = ['mini', colour, colour && !thisLap ? 'prev' : '', i === active ? 'active' : '']
        return <span key={id} className={classes.filter(Boolean).join(' ')} title={t > 0 ? `${t.toFixed(3)}s` : undefined} />
      })}
    </div>
  )
}
