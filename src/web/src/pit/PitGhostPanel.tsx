import type { CarRow } from '../types'
import { isF1 } from '../series'
import type { Neighbour } from './rejoin'
import type { PitGhost } from './usePitGhost'

/**
 * The "if they pitted now" card under the map. Always says it's an experimental estimate, where the stop cost comes
 * from, and how well it did in the backtests (tools/PitLoss/backtest.mts: 165 stops of the 2026 Bathurst 1000; 23 of the
 * 2025 Singapore GP, whose stops are also where the Singapore prior comes from).
 */
export function PitGhostPanel({ ghost, onClose }: { ghost: PitGhost; onClose: () => void }) {
  const { car, status, estimate, rejoin } = ghost
  const who = `#${car.carNumber} ${car.driver}`
  return (
    <section className="pit-ghost-panel" aria-label="Pit rejoin estimate">
      <header>
        <span className="pit-ghost-swatch" aria-hidden />
        <strong>Pit rejoin</strong>
        <span className="pit-ghost-badge" title="Worked out from timing data and past stops; not official">Estimate</span>
        <span className="pit-ghost-badge experimental" title="New and still being tuned">Experimental</span>
        <button type="button" className="pit-ghost-close" onClick={onClose} aria-label="Hide the pit rejoin estimate">×</button>
      </header>
      {status === 'caution' && (
        <p>Paused under the {isF1 ? 'safety car / VSC' : 'safety car'}: a stop costs much less now (Gold Coast 2025: about
          3–9 s instead of ~45 s), and too few have been measured to predict one.</p>
      )}
      {status === 'in-pit' && <p>{who} is in the pits now.</p>}
      {status === 'finished' && <p>The race is over.</p>}
      {status === 'unavailable' && <p>Not enough timing yet to place {who}: it shows after a lap or so.</p>}
      {status === 'ok' && estimate && rejoin && (
        <>
          <p className="pit-ghost-main">
            If {who} pitted now{isF1 ? '' : ` (stop ${estimate.stopNumber})`}: rejoins <b>P{rejoin.position}</b>
            {rejoin.best !== rejoin.worst && <> · likely P{rejoin.best}–P{rejoin.worst}</>}
          </p>
          <p>
            {rejoin.ahead ? <>{fmt(rejoin.ahead.gap)} behind {name(rejoin.ahead)}</> : 'No car ahead on the road'}
            {rejoin.behind && <> · {fmt(rejoin.behind.gap)} ahead of {name(rejoin.behind)}</>}
            {' · '}
            <span className={rejoin.clearAir ? 'pit-ghost-clear' : 'pit-ghost-traffic'}>{rejoin.clearAir ? 'clear air' : 'in traffic'}</span>
          </p>
          <p className="pit-ghost-source">
            Stop costs ~{Math.round(estimate.range[1])} s (middle half {estimate.range[0].toFixed(0)}–{estimate.range[2].toFixed(0)} s) ·{' '}
            {estimate.basis === 'none' ? <b>{estimate.source}</b> : estimate.source}
          </p>
        </>
      )}
      <p className="pit-ghost-note">
        Assumes every other car stays out.{' '}
        {isF1
          ? "Tested on the 2025 Singapore GP's 23 stops: the right position 57% of the time, within one place 83% (using that race's own stop times, so flattering)."
          : "Tested on the 2026 Bathurst 1000's 165 stops: the right position 43% of the time, within one place 73%."}
      </p>
    </section>
  )
}

function name(n: Neighbour): string {
  const lap = n.lapsApart > 0 ? ', a lap ahead' : n.lapsApart < 0 ? ', lapped' : ''
  return `#${n.car.carNumber} ${surname(n.car)}${lap}`
}

function surname(car: CarRow): string {
  return car.driver.split(' ').slice(-1)[0]
}

function fmt(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}
