import { finalsRoundFor } from '../finals'
import { STANDINGS_AFTER_R10 } from '../championship'

/**
 * The Finals field for an upcoming Finals round (event page): the drivers still in the title fight with the points they
 * start the round on (Supercars' official standings, finals.ts `field`), who's above the elimination cut going in, and
 * how many go through. The live Finals ladder (FinalsLadder) takes over once a race of the round is on.
 */
export function FinalsField({ meeting }: { meeting: string }) {
  const round = finalsRoundFor(meeting)
  if (!round?.field) return null
  const advance = round.finalists - round.eliminate
  const rows = round.field
    .map((f, i) => ({ ...f, seed: i + 1, driver: STANDINGS_AFTER_R10[f.car]?.[0] ?? `Car ${f.car}` }))
    .sort((a, b) => b.start - a.start || a.seed - b.seed)
  // Like Supercars' "Cut" column: inside the cut, points ahead of the first car out; outside, points behind the last
  // car in.
  const lastIn = rows[advance - 1]?.start ?? 0
  const firstOut = rows[advance]?.start ?? 0
  const cut = (start: number, rank: number) => (rank <= advance ? start - firstOut : start - lastIn)
  const cup = (car: string) => [car === round.cupWinners.sprint && 'Sprint Cup', car === round.cupWinners.enduro && 'Enduro Cup'].filter(Boolean).join(', ')

  const row = (r: (typeof rows)[number], i: number) => {
    const rank = i + 1
    const c = cut(r.start, rank)
    return (
      <div key={r.car} className={`ladder-row finals-row${rank > advance ? ' out' : ''}`}
        title={`Seed ${r.seed} after the Bathurst 1000${cup(r.car) ? ` · ${cup(r.car)} winner (+${round.cupBonus})` : ''}`}>
        <span className="ladder-pos">{rank}</span>
        <span className="ladder-move ladder-seed">S{r.seed}</span>
        <span className="ladder-driver">
          {r.driver} <span className="ladder-car">#{r.car}</span>
          {cup(r.car) && <span className="ladder-short"> · {cup(r.car)}</span>}
        </span>
        <span className={`ladder-today${c < 0 ? ' behind' : ''}`}>{c > 0 ? `+${c}` : c}</span>
        <span className="ladder-total">{r.start}</span>
      </div>
    )
  }

  return (
    <section className="ladder finals-field" aria-label="Finals field">
      <h2>The Finals field <span className="ladder-live">{round.finalists} drivers · {advance} go through</span></h2>
      <p className="finals-explain">
        Points reset for the Finals: everyone starts on {round.reset} plus a bonus for where they finished the regular
        season (up to {round.bonus[0]}), and {round.cupBonus} more for the Sprint and Enduro Cup winners. After the
        two races here the bottom {round.eliminate} are eliminated and {advance} go on to Sandown, where points reset
        again; three more go out there and 4 contest the Grand Final in Adelaide. A race win is worth {round.points[0]},
        10th {round.points[9]}. Eliminated drivers go back to their ordinary points and race on for 5th and below.
      </p>
      <div className="ladder-head"><span>Pos</span><span>Seed</span><span>Driver</span><span>Cut</span><span>Start</span></div>
      <div className="ladder-finals">
        <div className="ladder-finals-label">Through to Sandown if it ended now</div>
        {rows.slice(0, advance).map(row)}
      </div>
      <div className="ladder-elimination">
        <div className="ladder-elimination-label">Eliminated if it ended now</div>
        {rows.slice(advance).map((r, i) => row(r, advance + i))}
      </div>
      <p className="ladder-note">
        Starting points: Supercars' official Finals standings. Cut: points ahead of the first driver out (inside the
        top {advance}) or behind the last driver in. The live Finals ladder appears beside the tower during each race.
      </p>
    </section>
  )
}
