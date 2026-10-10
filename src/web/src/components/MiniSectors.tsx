import type { CarRow } from '../types'

/**
 * F1-style mini-sectors for one car: a block per stretch between timing points. Purple = fastest of anyone
 * this session, green = the car's personal best, yellow = slower. Stretches not yet reached on this lap show
 * the previous lap's colour, faded. The stretch the car is in now is outlined.
 */
export function MiniSectors({ car, order, sessionBest }: { car: CarRow; order: string[]; sessionBest: number[] }) {
  const current = car.currentSegments ?? []
  const last = car.lastLapSegments ?? []
  const best = car.bestSegments ?? []
  const active = car.inPit ? -1 : order.indexOf(car.lastPoint)

  return (
    <div className={`minis${car.inPit ? ' in-pit' : ''}`} aria-label="Mini-sectors">
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
