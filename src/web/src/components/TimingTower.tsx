import type { CarRow, TimingSnapshot } from '../types'
import { gapText, lapTime, seconds, timeClass } from '../format'
import { TrackProgress } from './TrackProgress'

export function TimingTower({ timing, highlightId, onHighlight }: {
  timing: TimingSnapshot
  highlightId: string | null
  onHighlight: (id: string | null) => void
}) {
  const { cars, best, timingPoints } = timing
  // Races: use the per-timing-point gaps. Practice/qualifying: gaps are to the fastest lap.
  const live = timing.session.type.toLowerCase() === 'race'
  return (
    <div className="tower-wrap">
      <table className="tower">
        <thead>
          <tr>
            <th className="num">Pos</th>
            <th>Car</th>
            <th>Driver</th>
            <th className="num">Laps</th>
            <th className="num">Gap</th>
            <th className="num">Int</th>
            <th className="num">Last</th>
            <th className="num">Best</th>
            <th className="num">S1</th>
            <th className="num">S2</th>
            <th className="num">S3</th>
            <th className="num">Speed</th>
            <th className="num">Pits</th>
            <th>Lap progress</th>
          </tr>
        </thead>
        <tbody>
          {cars.map((c, i) => (
            <Row key={c.id} car={c} isFirst={i === 0} live={live} best={best} points={timingPoints}
              highlighted={c.id === highlightId} onHighlight={onHighlight} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Row({ car: c, isFirst, live, best, points, highlighted, onHighlight }: {
  car: CarRow
  isFirst: boolean
  live: boolean
  highlighted: boolean
  onHighlight: (id: string | null) => void
  best: TimingSnapshot['best']
  points: TimingSnapshot['timingPoints']
}) {
  const gap = live ? c.liveGap : c.gap
  const gapLaps = live ? c.liveGapLaps : c.gapLaps
  const interval = live ? c.liveInterval : c.interval
  const intervalLaps = live ? c.liveIntervalLaps : c.intervalLaps
  return (
    <tr
      className={`${c.inPit ? 'in-pit' : ''} ${highlighted ? 'highlighted' : ''}`}
      onMouseEnter={() => onHighlight(c.id)}
      onMouseLeave={() => onHighlight(null)}
    >
      <td className="num pos">{c.position || ''}</td>
      <td>
        <span className={`car mfr-${c.manufacturer.toLowerCase()}`} title={c.vehicle}>{c.carNumber}</span>
      </td>
      <td className="driver">
        {c.driver}
        {c.inPit && <span className="pit-badge">PIT</span>}
      </td>
      <td className="num">{c.laps || ''}</td>
      <td className="num">{gapText(gap, gapLaps, isFirst)}</td>
      <td className="num">{isFirst ? '' : intervalLaps > 0 ? `+${intervalLaps}L` : seconds(interval) && `+${seconds(interval)}`}</td>
      {/* key on the value so the cell re-mounts and flashes when a new time arrives */}
      <td key={`last-${c.lastLap}`} className={`num flash ${timeClass(c.lastLap, c.bestLap, best.lap)}`}>{lapTime(c.lastLap)}</td>
      <td className={`num ${timeClass(c.bestLap, c.bestLap, best.lap) === 'session-best' ? 'session-best' : ''}`}>{lapTime(c.bestLap)}</td>
      <td key={`s1-${c.s1}`} className={`num flash ${timeClass(c.s1, c.bestS1, best.s1)}`}>{seconds(c.s1)}</td>
      <td key={`s2-${c.s2}`} className={`num flash ${timeClass(c.s2, c.bestS2, best.s2)}`}>{seconds(c.s2)}</td>
      <td key={`s3-${c.s3}`} className={`num flash ${timeClass(c.s3, c.bestS3, best.s3)}`}>{seconds(c.s3)}</td>
      <td className={`num ${best.speed && c.speed === best.speed ? 'session-best' : ''}`}>{c.speed || ''}</td>
      <td className="num">{c.pitStops || ''}</td>
      <td><TrackProgress lastPoint={c.lastPoint} points={points} /></td>
    </tr>
  )
}
