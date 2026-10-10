import type { CarRow, TimingSnapshot } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { lapTime } from '../format'
import { useSessionClock } from '../map/useSessionClock'

/**
 * The car currently on its run, for single-car sessions like the Top Ten Shootout.
 * Prefers a car on its flying lap, then the most recently active car on track.
 */
export function pickFocusCar(cars: CarRow[], now: number): CarRow | null {
  const onTrack = cars.filter((c) => !c.inPit && c.lastPoint && c.lastPointAt > now - 120)
  const recent = (xs: CarRow[]) => xs.sort((a, b) => b.lastPointAt - a.lastPointAt)[0] ?? null
  return recent(onTrack.filter((c) => c.lapsSincePit === 1)) ?? recent(onTrack)
}

/** Live comparison of the car on its run against provisional pole, timing point by timing point. */
export function ShootoutCard({ timing, track, clockRate }: { timing: TimingSnapshot; track: TrackDefinition | null; clockRate: number }) {
  const now = useSessionClock(timing.now, clockRate)
  const car = pickFocusCar(timing.cars, now)

  // Provisional pole: fastest best lap among the *other* cars, so a car on its lap is compared with
  // the time it has to beat.
  const others = timing.cars.filter((c) => c.id !== car?.id && c.bestLap > 0).sort((a, b) => a.bestLap - b.bestLap)
  const pole = others[0] ?? null
  const finished = timing.cars.filter((c) => c.bestLap > 0).length

  const points = [...timing.timingPoints.map((p) => ({ id: p.id, name: pointLabel(p.id, p.name, track) })), { id: 'M', name: 'Finish' }]

  if (!car) {
    return (
      <section className="shootout idle">
        <div className="shootout-title">On track</div>
        <div className="shootout-idle">
          No car on a run right now.{pole ? <> Provisional pole: <strong>#{pole.carNumber} {pole.driver}</strong> {lapTime(pole.bestLap)}</> : null}
          {finished > 0 && <> · {finished} completed</>}
        </div>
      </section>
    )
  }

  const phase = car.lapsSincePit === 0 || !car.lapStartAt ? 'out' : car.lapsSincePit === 1 ? 'flying' : 'in'
  // On the in-lap, show the lap just completed.
  const splits = (phase === 'in' ? car.lastLapSplits : car.currentSplits) ?? []
  const ref = pole?.bestLapSplits ?? []
  const lastReached = lastIndex(splits)
  const delta = lastReached >= 0 && ref[lastReached] > 0 ? splits[lastReached] - ref[lastReached] : null
  const running = phase === 'flying' && car.lapStartAt ? Math.max(0, now - car.lapStartAt) : null
  const result = phase === 'in' ? splits[splits.length - 1] : 0
  const position = lastReached >= 0 ? runningPosition(splits[lastReached], lastReached, timing.cars, car.id) : null

  return (
    <section className={`shootout phase-${phase}`}>
      <div className="shootout-head">
        <span className={`car mfr-${car.manufacturer.toLowerCase()}`}>{car.carNumber}</span>
        <div className="shootout-driver">
          <div className="name">{car.driver}</div>
          <div className="sub">{car.vehicle}</div>
        </div>
        <span className={`phase phase-${phase}`}>{phase === 'out' ? 'Out lap' : phase === 'flying' ? 'Flying lap' : 'Lap complete'}</span>
        <div className="shootout-time">
          {phase === 'flying' && running !== null && <span className="running">{formatRunning(running)}</span>}
          {phase === 'in' && result > 0 && <span className="result">{lapTime(result)}</span>}
          {phase === 'out' && pole && <span className="target">To beat {lapTime(pole.bestLap)}</span>}
        </div>
        <div className="shootout-summary">
          {delta !== null && <span className={`delta ${delta <= 0 ? 'ahead' : 'behind'}`}>{signed(delta)}</span>}
          {position !== null && <span className="position">{phase === 'in' ? 'P' : 'Running P'}{position}</span>}
        </div>
      </div>

      <ol className="splits">
        {points.map((p, i) => {
          const t = splits[i] || 0
          const d = t > 0 && ref[i] > 0 ? t - ref[i] : null
          return (
            <li key={p.id} className={[t > 0 ? 'reached' : '', d === null ? '' : d <= 0 ? 'ahead' : 'behind'].join(' ')}>
              <span className="split-name">{p.name}</span>
              <span className="split-delta">{d === null ? (t > 0 ? lapTime(t) : '') : signed(d)}</span>
            </li>
          )
        })}
      </ol>

      <div className="shootout-foot">
        {pole ? <>Provisional pole <strong>#{pole.carNumber} {pole.driver}</strong> {lapTime(pole.bestLap)}</> : 'First car out: no time to beat yet'}
        {!ref.some((x) => x > 0) && pole && <span className="muted"> · split comparison appears once pole's lap is seen live</span>}
      </div>
    </section>
  )
}

function lastIndex(splits: number[]): number {
  for (let i = splits.length - 1; i >= 0; i--) if (splits[i] > 0) return i
  return -1
}

/** Where this split would rank against other cars' best laps at the same point. */
function runningPosition(split: number, index: number, cars: CarRow[], selfId: string): number | null {
  const others = cars.filter((c) => c.id !== selfId && (c.bestLapSplits?.[index] ?? 0) > 0)
  if (others.length === 0) return null
  return 1 + others.filter((c) => c.bestLapSplits[index] < split).length
}

/** Name a timing point after the nearest corner on the track file, e.g. "Hell Corner". */
function pointLabel(id: string, fallback: string, track: TrackDefinition | null): string {
  const tp = track?.timingPoints.find((p) => p.id === id)
  if (!track || !tp) return fallback
  const candidates = track.labels.filter((l) => !/line$|straight$/i.test(l.name))
  const nearest = candidates.sort((a, b) => Math.abs(a.distance - tp.distance) - Math.abs(b.distance - tp.distance))[0]
  return nearest && Math.abs(nearest.distance - tp.distance) < 400 ? nearest.name : fallback
}

const signed = (d: number) => `${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}`

function formatRunning(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}
