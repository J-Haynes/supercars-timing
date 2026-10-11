import type { TimingSnapshot } from '../types'
import { lapTime } from '../format'

/** Natsoft time is track-local wall-clock time encoded as Unix seconds, so format it as UTC to get track time. */
const trackTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 19)

/**
 * Race control messages (incidents, investigations, penalties), newest first, with the lap record on top.
 * Penalties are highlighted; the tower also badges the car.
 */
export function RaceControl({ timing, limit = 12 }: { timing: TimingSnapshot; limit?: number }) {
  const messages = (timing.raceControl ?? []).slice(0, limit)
  const record = timing.session.lapRecord
  const beaten = record && timing.best.lap && timing.best.lap < record.seconds
    ? timing.cars.find((c) => Math.abs(c.bestLap - (timing.best.lap ?? 0)) < 0.0005)
    : undefined

  return (
    <section className="race-control" aria-label="Race control">
      <h2>Race control</h2>
      {record && (
        <div className={`lap-record${beaten ? ' beaten' : ''}`}>
          {beaten ? (
            <>New lap record: <strong>{lapTime(timing.best.lap)}</strong> {beaten.driver} (was {lapTime(record.seconds)}, {record.driver})</>
          ) : (
            <>Lap record: <strong>{lapTime(record.seconds)}</strong> {record.driver} · {record.vehicle}</>
          )}
        </div>
      )}
      {messages.length === 0 ? (
        <div className="race-control-empty">No messages yet.</div>
      ) : (
        <ul>
          {messages.map((m) => (
            <li key={`${m.time}-${m.text}`} className={/penalty/i.test(m.text) ? 'penalty' : ''}>
              <span className="rc-time">{trackTime(m.time)}</span>
              <span className="rc-text">{m.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
