import type { TimingSnapshot } from '../types'
import { finalsLadder, finalsRoundFor } from '../finals'
import { useFinalsData } from '../useFinalsData'

/**
 * Finals round ladder: the finalists' reset points + bonus + points from this round's completed races + projected
 * points for the race on now. Those who advance sit in the gold border; the bottom three are below a red
 * elimination line. Drivers outside the Finals follow with their ordinary points.
 */
export function FinalsLadder({ timing, onHighlight }: { timing: TimingSnapshot; onHighlight: (ids: string[]) => void }) {
  const round = finalsRoundFor(timing.session.meeting)
  const data = useFinalsData(round, timing.session.name)
  if (!round || !data) return null
  const { rows, others, advance } = finalsLadder(timing, round, data.bathurst, data.earlier)
  const cut = rows[advance - 1]?.total ?? 0

  const finalist = (r: (typeof rows)[number]) => (
    <div key={r.carNumber} className={`ladder-row finals-row${r.rank > advance ? ' out' : ''}`} onMouseEnter={() => onHighlight(r.carId ? [r.carId] : [])}
      title={`Started the round on ${r.start} (seed ${r.seed})${r.banked ? `, +${r.banked} from earlier races` : ''}`}>
      <span className="ladder-pos">{r.rank}</span>
      <span className="ladder-move ladder-seed">S{r.seed}</span>
      <span className="ladder-driver">
        {r.driver} <span className="ladder-car">#{r.carNumber}</span>
        {r.rank > advance && <span className="ladder-short"> · {cut - r.total} to safety</span>}
      </span>
      <span className="ladder-today">{r.today ? `+${r.today}` : ''}</span>
      <span className="ladder-total">{r.total}</span>
    </div>
  )

  return (
    <section className="ladder" aria-label="Finals ladder" onMouseLeave={() => onHighlight([])}>
      <h2>Finals ladder <span className="ladder-live">live, if the race finished now</span></h2>
      <div className="ladder-head"><span>Pos</span><span>Seed</span><span>Driver</span><span>Today</span><span>Total</span></div>
      <div className="ladder-finals">
        <div className="ladder-finals-label">Top {advance} advance</div>
        {rows.slice(0, advance).map(finalist)}
      </div>
      <div className="ladder-elimination">
        <div className="ladder-elimination-label">Eliminated after this round</div>
        {rows.slice(advance).map(finalist)}
      </div>
      {others.length > 0 && (
        <details className="ladder-others">
          <summary>Outside the Finals ({others.length}), ordinary points</summary>
          {others.map((o, i) => (
            <div key={o.carNumber} className="ladder-row" onMouseEnter={() => onHighlight(o.carId ? [o.carId] : [])}>
              <span className="ladder-pos">{rows.length + i + 1}</span><span />
              <span className="ladder-driver">{o.driver} <span className="ladder-car">#{o.carNumber}</span></span>
              <span className="ladder-today">{o.today ? `+${o.today}` : ''}</span>
              <span className="ladder-total">{o.total}</span>
            </div>
          ))}
        </details>
      )}
      <p className="ladder-note">
        Start: {round.reset} + bonus {round.bonus.join('/')} by position after Bathurst
        {round.cupBonus ? `, +${round.cupBonus} for the Sprint and Enduro Cup winners` : ''}. Race points {round.points.slice(0, 3).join('/')}…
        Bathurst result from our recording (post-race penalties not included).
        {!round.cupWinners.enduro && ' Enduro Cup winner not set yet.'}
      </p>
    </section>
  )
}
