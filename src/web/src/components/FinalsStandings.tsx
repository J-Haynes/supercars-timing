import type { TimingSnapshot } from '../types'
import { finalsRoundFor, roundStandings, type FinalsRound, type StandingRow } from '../finals'
import { projectedFinish } from '../championship'
import { flagKind } from '../session'
import { useFinalsData } from '../useFinalsData'

/** The championship's own races (not support categories, qualifying or the Shootout): the only ones paying points. */
const POINTS_RACE = /supercars championship - race \d+$/i

/**
 * Championship standings at a Finals round, the same on the event page and in the live tab: the finalists on their
 * Finals points with the elimination cut (gold: through if it ended now; red dashed: out), then every other driver on
 * ordinary points. `live` adds the race on now as provisional points in their own column; outside a race the table
 * only shows points already earned.
 */
function StandingsTable({ round, rows, advance, live, onHighlight }: {
  round: FinalsRound
  rows: StandingRow[]
  advance: number
  live: boolean
  onHighlight?: (carNumber: string | undefined) => void
}) {
  const finalists = rows.filter((r) => r.finalist)
  const rest = rows.filter((r) => !r.finalist)
  // Inside the cut: points clear of the first finalist out; outside: points short of the last one in.
  const lastIn = finalists[advance - 1]?.total ?? 0
  const firstOut = finalists[advance]?.total ?? 0
  const cut = (r: StandingRow, i: number) => (i < advance ? `${r.total - firstOut} clear` : `${lastIn - r.total} behind`)

  const row = (r: StandingRow, i: number, finalist: boolean) => {
    const moved = live ? r.rankNow - r.rank : 0
    return (
      <div key={r.driver} className={`standings-row${live ? ' live' : ''}${finalist && i >= advance ? ' out' : ''}${finalist ? '' : ' plain'}${r.carNumber ? '' : ' absent'}`}
        onMouseEnter={() => onHighlight?.(r.carNumber)}
        title={[r.seed && `Seed ${r.seed} going into the Finals`, r.cup && `${r.cup} winner (+${round.cupBonus})`, !r.carNumber && 'Not entered in this round (co-driver or wildcard)'].filter(Boolean).join(' · ') || undefined}>
        <span className="standings-pos">{r.rank}</span>
        {live && <span className={`standings-move${moved > 0 ? ' up' : moved < 0 ? ' down' : ''}`}>{moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : ''}</span>}
        <span className="standings-driver">
          {r.driver}{r.carNumber && <span className="standings-car"> #{r.carNumber}</span>}
          {r.cup && <span className="standings-tag"> · {r.cup}</span>}
          {live && r.finish > 0 && <span className="standings-tag" title="Running position in this race"> · P{r.finish}</span>}
        </span>
        {live && <span className="standings-now">{r.points}</span>}
        <span className="standings-extra">
          {live ? (r.live ? `+${r.live}` : '') : finalist ? <span className={i < advance ? 'clear' : 'behind'}>{cut(r, i)}</span> : ''}
        </span>
        <span className="standings-points">{r.total}</span>
      </div>
    )
  }

  return (
    <div className={`standings${live ? ' live' : ''}`} onMouseLeave={() => onHighlight?.(undefined)}>
      <div className="standings-row standings-head">
        <span>Pos</span>
        {live && <span />}
        <span>Driver</span>
        {live && <span>Now</span>}
        <span>{live ? 'Race' : 'Cut'}</span>
        <span>{live ? 'Total' : 'Points'}</span>
      </div>
      <div className="ladder-finals">
        <div className="ladder-finals-label">Finalists · through to the next round if it ended now</div>
        {finalists.slice(0, advance).map((r, i) => row(r, i, true))}
      </div>
      <div className="ladder-elimination">
        <div className="ladder-elimination-label">Finalists · eliminated if it ended now</div>
        {finalists.slice(advance).map((r, i) => row(r, advance + i, true))}
      </div>
      <details className="standings-rest" open>
        <summary>Rest of the championship ({rest.length}) · ordinary points</summary>
        {rest.map((r, i) => row(r, finalists.length + i, false))}
      </details>
    </div>
  )
}

/** Points for each finishing place in a race of the round (the same for every driver, finalist or not). */
export function PointsOnOffer({ round, open = true }: { round: FinalsRound; open?: boolean }) {
  return (
    <details className="points-offer" open={open}>
      <summary>Points on offer · each race</summary>
      <ol className="points-offer-grid">
        {round.points.map((p, i) => <li key={i}><span>P{i + 1}</span><b>{p}</b></li>)}
      </ol>
      <p className="ladder-note">
        Both races pay the same, to every driver: up to {round.points[0] * 2} for the weekend. {round.points.length + 1}th
        and below score nothing. Race points from the 2026 season's points table.
      </p>
    </details>
  )
}

/** Event page: the standings going into the round (plus any race already run there), the cut and the points on offer. */
export function FinalsField({ meeting }: { meeting: string }) {
  const round = finalsRoundFor(meeting)
  const data = useFinalsData(round, '')
  const standings = round && roundStandings(round, data?.earlier ?? [])
  if (!round || !standings) return null
  const { rows, advance } = standings
  const run = data?.earlier.length ?? 0
  return (
    <section className="ladder finals-field" aria-label="Championship standings">
      <h2>Championship standings <span className="ladder-live">{run ? `after ${run} race${run > 1 ? 's' : ''} here` : 'now, after Bathurst'} · {advance} of {round.finalists} finalists go through</span></h2>
      <p className="finals-explain">
        The top {round.finalists} after Bathurst are the finalists. Their points were reset for the Finals: {round.reset} plus
        a bonus for where they finished the regular season (up to {round.bonus[0]}), and {round.cupBonus} more for the Sprint
        and Enduro Cup winners. After the two races here the bottom {round.eliminate} finalists are eliminated and {advance} go
        on to Sandown; three more go out there and 4 contest the Grand Final in Adelaide. Everyone else, and eliminated
        drivers, race on with their ordinary points for 11th and below.
      </p>
      <StandingsTable round={round} rows={rows} advance={advance} live={false} />
      <PointsOnOffer round={round} />
      <p className="ladder-note">
        Points now: Supercars' official Finals standings for the finalists, the championship after Bathurst (Speedcafe)
        for everyone else{run ? ', plus the races here from our recordings (before any post-race penalties)' : ''}. Cut: points
        clear of the first finalist out, or behind the last one in. The live tab shows these standings all weekend, and
        provisional points during the two races.
      </p>
    </section>
  )
}

/**
 * Live tab (live and replay), every session of a Finals round: the standings as they are, and during the round's two
 * races (from the green flag) provisional points for where each car is running, with the standings they'd give.
 */
export function FinalsLadder({ timing, onHighlight }: { timing: TimingSnapshot; onHighlight: (ids: string[]) => void }) {
  // Championship sessions only (support categories share the feed; the live view hides them, replays don't).
  const round = /supercars championship/i.test(timing.session.name) ? finalsRoundFor(timing.session.meeting) : undefined
  const data = useFinalsData(round, timing.session.name)
  const pointsRace = POINTS_RACE.test(timing.session.name) && (timing.session.greenAt ?? 0) > 0
  const live = pointsRace ? projectedFinish(timing).map((c) => c.carNumber) : undefined
  const standings = round && data ? roundStandings(round, data.earlier, live) : undefined
  if (!round || !standings) return null
  const finished = flagKind(timing.session.flag) === 'finished'
  const highlight = (car: string | undefined) => {
    const id = car ? timing.cars.find((c) => c.carNumber === car)?.id : undefined
    onHighlight(id ? [id] : [])
  }
  return (
    <section className="ladder finals-ladder" aria-label="Championship standings">
      <h2>
        Championship standings{' '}
        <span className="ladder-live">
          {live ? (finished ? 'provisional result, before any post-race penalties' : 'provisional: if the race finished now') : 'points earned so far'}
        </span>
      </h2>
      <StandingsTable round={round} rows={standings.rows} advance={standings.advance} live={!!live} onHighlight={highlight} />
      <PointsOnOffer round={round} open={false} />
      <p className="ladder-note">
        {live && 'Now: points earned before this race. Race: points for the position each car is running in. '}
        Finalists on Supercars' official Finals points, everyone else on the championship after Bathurst
        {data?.earlier.length ? ', plus earlier races here from our recordings' : ''}.
      </p>
    </section>
  )
}
