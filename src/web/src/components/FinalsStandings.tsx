import { useState } from 'react'
import type { TimingSnapshot } from '../types'
import { finalsRoundFor, resultOrder, roundStandings, type FinalsRound, type StandingRow } from '../finals'
import { projectedFinish } from '../championship'
import { flagKind } from '../session'
import { useFinalsData } from '../useFinalsData'
import { teamsRoundFor, type TeamsRound } from '../teams'
import { useStandings } from '../useWeekend'

/** The championship's own races (not support categories, qualifying or the Shootout): the only ones paying points. */
const POINTS_RACE = /supercars championship - race \d+$/i

/**
 * Championship standings at a Finals round, the same on the event page and in the live tab: the finalists on their
 * Finals points with the elimination cut (gold: through if it ended now; red dashed: out), then every other driver on
 * ordinary points. `live` adds the race on now as provisional points in their own column; outside a race the table
 * only shows points already earned.
 */
function StandingsTable({ round, rows, live, onHighlight, secured, uncertain, tieOrderKnown }: {
  round: FinalsRound
  rows: StandingRow[]
  live: boolean
  onHighlight?: (carNumber: string | undefined) => void
  secured: Map<string, 'win' | 'points'>
  uncertain: Set<string>
  tieOrderKnown: boolean
}) {
  const finalists = rows.filter((r) => r.finalist)
  const through = finalists.filter((r) => !r.out && !uncertain.has(r.carNumber!))
  const out = finalists.filter((r) => r.out && !uncertain.has(r.carNumber!))
  const undecided = finalists.filter((r) => uncertain.has(r.carNumber!))
  const rest = rows.filter((r) => !r.finalist)
  // Win and you're in (finals.ts): a race winner is through whatever their points, so the cut is between the lowest
  // finalist through on points and the highest one out.
  const onPoints = finalists.filter((r) => !r.out && r.wins === 0 && !r.leading)
  const lastIn = onPoints.at(-1)?.total ?? 0
  const firstOut = finalists.find(r => r.out)?.total ?? 0
  const cut = (r: StandingRow) =>
    uncertain.has(r.carNumber!) ? 'tie unconfirmed' : r.out ? `${lastIn - r.total} behind` : r.wins > 0 ? 'won · through' : r.leading ? 'leading' : out.length ? `${r.total - firstOut} clear` : ''

  const row = (r: StandingRow, finalist: boolean) => {
    const moved = live ? r.rankNow - r.rank : 0
    return (
      <div key={r.driver} className={`standings-row${live ? ' live' : ''}${finalist && r.out && !uncertain.has(r.carNumber!) ? ' out' : ''}${finalist ? '' : ' plain'}${r.carNumber ? '' : ' absent'}`}
        onMouseEnter={() => onHighlight?.(r.carNumber)}
        title={[r.seed && `Seed ${r.seed} going into the Finals`, r.cup && `${r.cup} winner (+${round.cupBonus})`, !r.carNumber && 'Not entered in this round (co-driver or wildcard)'].filter(Boolean).join(' · ') || undefined}>
        <span className="standings-pos">{uncertain.has(r.carNumber!) ? '—' : r.rank}</span>
        {live && <span className={`standings-move${moved > 0 ? ' up' : moved < 0 ? ' down' : ''}`}>{moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : ''}</span>}
        <span className="standings-driver">
          {r.driver}{r.carNumber && <span className="standings-car"> #{r.carNumber}</span>}
          {finalist && (uncertain.has(r.carNumber!)
            ? <span className="finals-marker">Tie · advancement unconfirmed</span>
            : secured.has(r.carNumber!)
            ? <span className="finals-marker secured">🔒 Secured · {secured.get(r.carNumber!) === 'win' ? 'win' : 'points'}</span>
            : <span className={`finals-marker ${r.out ? 'below' : 'projected'}`}>{r.out ? 'Below cut' : '◇ Projected through'}</span>)}
          {r.cup && <span className="standings-tag"> · {r.cup}</span>}
          {finalists.some((o) => o !== r && o.total === r.total) && finalist && (
            <span className="standings-tag" title="Level on points: the latest race classification decides (Operations Manual D14.1.5.1)">{tieOrderKnown ? ' · level, split by race order' : ' · level, latest race order unconfirmed'}</span>
          )}
          {finalist && live && r.leading && r.wins === 0 && !secured.has(r.carNumber!) && <span className="standings-tag" title="Leading this race: a win puts a finalist through, whatever the points"> · leading: through if it ends now</span>}
          {live && r.finish > 0 && <span className="standings-tag" title="Running position in this race"> · P{r.finish}</span>}
        </span>
        {live && <span className="standings-now">{r.points}</span>}
        <span className="standings-extra">
          {live ? (r.live ? `+${r.live}` : '') : finalist ? <span className={r.out ? 'behind' : 'clear'}>{cut(r)}</span> : ''}
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
        {through.map((r) => row(r, true))}
      </div>
      <div className="ladder-elimination">
        <div className="ladder-elimination-label">Finalists · eliminated if it ended now</div>
        {out.map((r) => row(r, true))}
      </div>
      {undecided.length > 0 && <div className="ladder-uncertain">
        <div className="ladder-finals-label">Finalists · tied at the cut · latest race classification unconfirmed</div>
        {undecided.map(r => row(r, true))}
      </div>}
      <details className="standings-rest" open>
        <summary>Rest of the championship ({rest.length}) · ordinary points</summary>
        {rest.map((r) => row(r, false))}
      </details>
    </div>
  )
}

/**
 * Teams' championship going into the round (teams.ts, Supercars' standings), with each entry's cars and garages: the
 * order sets the pit lane, leaders nearest pit exit. Races at the round aren't added (how the Finals count for teams
 * isn't in our sources).
 */
function TeamsTable({ round, onHighlight }: { round: TeamsRound; onHighlight?: (carNumbers: string[]) => void }) {
  const leader = round.standings[0]?.points ?? 0
  const garagesOf = (cars: string[]) => cars.map((c) => round.garages.indexOf(c) + 1).filter((g) => g > 0).sort((a, b) => a - b)
  return (
    <div className="standings" onMouseLeave={() => onHighlight?.([])}>
      <div className="standings-row standings-head">
        <span>Pos</span>
        <span>Team</span>
        <span>Gap</span>
        <span>Points</span>
      </div>
      {round.standings.map((t, i) => {
        const garages = garagesOf(t.cars)
        return (
          <div key={t.name} className={`standings-row plain${t.cars.length ? '' : ' absent'}`} onMouseEnter={() => onHighlight?.(t.cars)}
            title={[t.team !== t.name && t.team, !t.cars.length && 'Not entered in this round (wildcard)'].filter(Boolean).join(' · ') || undefined}>
            <span className="standings-pos">{i + 1}</span>
            <span className="standings-driver">
              {t.name}{t.cars.length > 0 && <span className="standings-car"> {t.cars.map((c) => `#${c}`).join(' ')}</span>}
              {garages.length > 0 && <span className="standings-tag"> · garage{garages.length > 1 ? 's' : ''} {garages.length > 1 ? `${garages[0]}-${garages[garages.length - 1]}` : garages[0]}</span>}
            </span>
            <span className="standings-extra">{i > 0 ? `-${leader - t.points}` : ''}</span>
            <span className="standings-points">{t.points}</span>
          </div>
        )
      })}
    </div>
  )
}

type ChampionshipTab = 'drivers' | 'teams'

/** Drivers | Teams switch over the standings. */
function ChampionshipTabs({ tab, onTab }: { tab: ChampionshipTab; onTab: (tab: ChampionshipTab) => void }) {
  return (
    <div className="segmented small championship-tabs" role="tablist" aria-label="Championship">
      {(['drivers', 'teams'] as const).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => onTab(k)}>
          {k === 'drivers' ? 'Drivers' : 'Teams'}
        </button>
      ))}
    </div>
  )
}

/** The note under the teams' table. */
function TeamsNote({ round }: { round: TeamsRound }) {
  return (
    <p className="ladder-note">
      Teams' championship after Bathurst (Supercars' standings); points from races here aren't added yet. It sets the pit
      lane: the leading team gets the two garages nearest pit exit, and so on down (<a href={round.source} target="_blank" rel="noreferrer">this round's order</a>).
      The map puts each car in its garage.
    </p>
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
  const teams = teamsRoundFor(meeting)
  const [tab, setTab] = useState<ChampionshipTab>('drivers')
  const data = useFinalsData(round, '')
  const standings = round && roundStandings(round, data?.earlier ?? [])
  if (!round || !standings) return null
  if (teams && tab === 'teams') {
    return (
      <section className="ladder finals-field" aria-label="Championship standings">
        <h2>Championship standings <span className="ladder-live">teams, after Bathurst</span></h2>
        <ChampionshipTabs tab={tab} onTab={setTab} />
        <TeamsTable round={teams} />
        <TeamsNote round={teams} />
      </section>
    )
  }
  const { rows, advance } = standings
  const run = data?.earlier.length ?? 0
  return (
    <section className="ladder finals-field" aria-label="Championship standings">
      <h2>Championship standings <span className="ladder-live">{run ? `after ${run} race${run > 1 ? 's' : ''} here` : round.asOf} · {advance} of {round.finalists} finalists go through</span></h2>
      {teams && <ChampionshipTabs tab={tab} onTab={setTab} />}
      {round.firstRace === 33 ? <p className="finals-explain">Seven drivers contest the Sandown Semi Final; four advance to Adelaide. A finalist who wins either Sandown race is secured for the Grand Final. Everyone else qualifies on points, with the latest race classification breaking ties. A current race leader is only provisionally through.</p> : <p className="finals-explain">
        The top {round.finalists} after Bathurst are the finalists. Their points were reset for the Finals: {round.reset} plus
        a bonus for where they finished the regular season (up to {round.bonus[0]}), and {round.cupBonus} more for the Sprint
        and Enduro Cup winners. After the two races here the bottom {round.eliminate} finalists are eliminated and {advance} go
        on to Sandown, except that a finalist who wins a race here is through whatever their points (the next lowest goes
        out instead); three more go out there and 4 contest the Grand Final in Adelaide. Everyone else, and eliminated
        drivers, race on with their ordinary points for 11th and below.
      </p>}
      <StandingsTable round={round} rows={rows} live={false} secured={standings.secured} uncertain={standings.uncertain} tieOrderKnown={standings.tieOrderKnown} />
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
export function FinalsLadder({ timing, onHighlight, liveFeed = false }: { timing: TimingSnapshot; onHighlight: (ids: string[]) => void; liveFeed?: boolean }) {
  // Championship sessions only (support categories share the feed; the live view hides them, replays don't).
  const round = /supercars championship/i.test(timing.session.name) ? finalsRoundFor(timing.session.meeting) : undefined
  const teams = round ? teamsRoundFor(timing.session.meeting) : undefined
  const [tab, setTab] = useState<ChampionshipTab>('drivers')
  const data = useFinalsData(round, timing.session.name, timing.session.meeting)
  const published = useStandings(2026)
  const currentRace = Number(/race (\d+)$/i.exec(timing.session.name)?.[1])
  const earlier = new Map<number, string[]>()
  if (round && liveFeed) for (const [race, order] of Object.entries(published?.raceResults ?? {})) {
    if (Number(race) >= round.firstRace && Number(race) < round.firstRace + 2 && (!currentRace || Number(race) < currentRace)) earlier.set(Number(race), order)
  }
  data?.earlier.forEach((order, i) => { if (round && data.raceNumbers[i] >= round.firstRace && data.raceNumbers[i] < round.firstRace + 2) earlier.set(data.raceNumbers[i], order) })
  const earlierOrders = [...earlier].sort(([a], [b]) => a - b).map(([, order]) => order)
  const priorScores = new Map<number, Record<string, number>>()
  const priorWinners = new Map<number, string>()
  earlier.forEach((order, race) => {
    priorScores.set(race, Object.fromEntries(order.map((car, i) => [car, round?.points[i] ?? 0])))
    if (order[0]) priorWinners.set(race, order[0])
  })
  if (round && liveFeed) for (const [race, points] of Object.entries(published?.racePoints ?? {})) {
    const number = Number(race)
    if (number >= round.firstRace && number < round.firstRace + 2 && (!currentRace || number < currentRace)) {
      priorScores.set(number, points)
      if (published?.raceWinners?.[race]) priorWinners.set(number, published.raceWinners[race])
    }
  }
  const priorPoints: Record<string, number> = {}
  priorScores.forEach(points => Object.entries(points).forEach(([car, score]) => { priorPoints[car] = (priorPoints[car] ?? 0) + score }))
  const lastRaceOrder = earlier.get(Math.max(...priorScores.keys()))
  const expectedPrior = round && currentRace ? Math.max(0, Math.min(2, currentRace - round.firstRace)) : priorScores.size
  const complete = priorScores.size >= expectedPrior
  const pointsRace = POINTS_RACE.test(timing.session.name) && (timing.session.greenAt ?? 0) > 0
  const finished = flagKind(timing.session.flag) === 'finished'
  const live = pointsRace ? (finished ? resultOrder(timing) : projectedFinish(timing).map((c) => c.carNumber)) : undefined
  const standings = round ? roundStandings(round, earlierOrders, live, finished && !!live,
    { points: priorPoints, winners: [...priorWinners.values()], completed: priorScores.size, complete, lastRaceOrder }) : undefined
  if (!round || !standings) return null
  const highlight = (car: string | undefined) => {
    const id = car ? timing.cars.find((c) => c.carNumber === car)?.id : undefined
    onHighlight(id ? [id] : [])
  }
  if (teams && tab === 'teams') {
    return (
      <section className="ladder finals-ladder" aria-label="Championship standings">
        <h2>Championship standings <span className="ladder-live">teams, after Bathurst</span></h2>
        <ChampionshipTabs tab={tab} onTab={setTab} />
        <TeamsTable round={teams} onHighlight={(cars) => onHighlight(timing.cars.filter((c) => cars.includes(c.carNumber)).map((c) => c.id))} />
        <TeamsNote round={teams} />
      </section>
    )
  }
  return (
    <section className="ladder finals-ladder" aria-label="Championship standings">
      <h2>
        Finals projection · {round.nextRound}{' '}
        <span className="ladder-live">
          {live ? (finished ? 'provisional result, before any post-race penalties' : 'provisional: if the race finished now') : 'points earned so far'}
        </span>
      </h2>
      {teams && <ChampionshipTabs tab={tab} onTab={setTab} />}
      <StandingsTable round={round} rows={standings.rows} live={!!live} onHighlight={highlight} secured={standings.secured} uncertain={standings.uncertain} tieOrderKnown={standings.tieOrderKnown} />
      {!complete && <p className="ladder-note" role="status">Projection incomplete: an earlier race result at this round is not available yet. Points-based secured places are unconfirmed.</p>}
      <p className="ladder-note">◇ Projected through: based on the current running order. 🔒 Secured: a completed win at this round, or a mathematically safe points margin including remaining win-to-advance seats. All live results remain provisional until penalties are settled.</p>
      <PointsOnOffer round={round} open={false} />
      <p className="ladder-note">
        {live && 'Now: points earned before this race. Race: points for the position each car is running in. '}
        {round.asOf}, plus earlier races at this round from published points or completed recordings.
      </p>
    </section>
  )
}
