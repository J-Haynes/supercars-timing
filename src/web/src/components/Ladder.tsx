import type { TimingSnapshot } from '../types'
import { liveLadder } from '../championship'

/**
 * Live championship ladder: points before the race + points for each car's projected finishing position today.
 * The top 10 go to the Finals, so they sit inside a gold border with the cut line below. Hovering a row highlights
 * the car in the tower and on the map.
 */
export function Ladder({ timing, onHighlight }: { timing: TimingSnapshot; onHighlight: (ids: string[]) => void }) {
  const ladder = liveLadder(timing)
  if (!ladder) return null
  const { rows, finalsCut } = ladder
  const cutPoints = rows[finalsCut - 1]?.total ?? 0

  const row = (r: (typeof rows)[number]) => {
    const moved = r.rankBefore - r.rank
    return (
      <div key={r.carNumber} className="ladder-row" onMouseEnter={() => onHighlight(r.carId ? [r.carId] : [])}>
        <span className="ladder-pos">{r.rank}</span>
        <span className={`ladder-move ${moved > 0 ? 'up' : moved < 0 ? 'down' : ''}`}>{moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : '–'}</span>
        <span className="ladder-driver">
          {r.driver} <span className="ladder-car">#{r.carNumber}</span>
          {r.rank > finalsCut && <span className="ladder-short" title="Points behind 10th"> · {cutPoints - r.total} off P{finalsCut}</span>}
        </span>
        <span className="ladder-today" title={r.finish ? `Running P${r.finish} today` : 'Not running'}>{r.today ? `+${r.today}` : ''}</span>
        <span className="ladder-total">{r.total}</span>
      </div>
    )
  }

  return (
    <section className="ladder" aria-label="Championship ladder" onMouseLeave={() => onHighlight([])}>
      <h2>Championship ladder <span className="ladder-live">live, if the race finished now</span></h2>
      <div className="ladder-head">
        <span>Pos</span><span /><span>Driver</span><span>Today</span><span>Total</span>
      </div>
      <div className="ladder-finals">
        <div className="ladder-finals-label">Top {finalsCut} advance to the Finals</div>
        {rows.slice(0, finalsCut).map(row)}
      </div>
      {rows.slice(finalsCut).map(row)}
      <p className="ladder-note">Points before today: standings after Round 10. Today: Enduro points for the car's position now, time penalties applied. Enduro Cup bonus points not included.</p>
    </section>
  )
}
