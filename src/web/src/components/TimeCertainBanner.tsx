import type { LapHistory, TimingSnapshot } from '../types'
import { useLapHistory } from '../useLapHistory'
import { finishOutlook, timeCertainAt } from '../timeCertain'

/** hh:mm of a Natsoft time (track time, counted as UTC). */
const trackTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 16)
const minutes = (s: number) => `${Math.max(1, Math.round(Math.abs(s) / 60))} min`

/**
 * Under the safety-car banner in a race once race control has set a time certain: will the race run its distance
 * before then, at the leader's green-flag pace? Live and replay (`history`: a replay's laps up to the replay time;
 * undefined = fetch the live lap history). Supercars only in practice: F1 sends no time certain message.
 */
export function TimeCertainBanner({ timing, history: given }: { timing: TimingSnapshot; history?: LapHistory | null }) {
  const announced = timeCertainAt(timing.session.name, timing.raceControl) !== undefined
  const live = useLapHistory(timing.session.name, { enabled: given === undefined && announced })
  const outlook = announced ? finishOutlook(timing, given === undefined ? live : given) : undefined
  if (!outlook) return null
  const o = outlook
  const pace = `the leader's green-flag pace (${o.pace.toFixed(1)} s, last ${o.paceLaps} green laps)`
  return (
    <div className={`tc-banner ${o.full ? 'full' : 'short'}`} role="status"
      title={`Time certain: the race ends at ${trackTime(o.deadline)} track time even if the distance isn't run. Estimate from ${pace}; safety-car laps at this race's caution pace.`}>
      <strong>Time certain {trackTime(o.deadline)}</strong>
      {o.full ? (
        <>
          <span className="tc-verdict">Full distance likely</span>
          <span>{o.lapsLeft} {o.lapsLeft === 1 ? 'lap' : 'laps'} to go, finish ≈ {trackTime(o.finishAt)} at green pace</span>
          <span>{minutes(o.spare)} spare{o.cautionLaps > 0 ? `, ≈ ${o.cautionLaps} safety-car ${o.cautionLaps === 1 ? 'lap' : 'laps'}` : ''}</span>
        </>
      ) : (
        <>
          <span className="tc-verdict">Time will run out</span>
          <span>≈ {o.lapsByDeadline} of {o.total} laps at green pace</span>
          <span>{minutes(o.spare)} short</span>
        </>
      )}
    </div>
  )
}
