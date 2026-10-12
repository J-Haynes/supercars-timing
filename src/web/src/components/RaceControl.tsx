import type { TimingSnapshot } from '../types'
import { lapTime } from '../format'
import { servedMessages } from '../penalties'

/** Natsoft time is track-local wall-clock time encoded as Unix seconds, so format it as UTC to get track time. */
const trackTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 19)

/**
 * Race control messages (incidents, investigations, penalties), newest first, with the lap record on top.
 * Penalties are highlighted; the tower also badges the car.
 */
export function RaceControl({ timing, limit = 12 }: { timing: TimingSnapshot; limit?: number }) {
  // Natsoft's messages plus our own "Penalty served" lines (penalties.ts), newest first.
  const messages = [...(timing.raceControl ?? []), ...servedMessages(timing)]
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
  const record = timing.session.lapRecord
  // Today's fastest lap. Natsoft's "record" (<E RI RC>) is the stored race lap record for this track and category,
  // not today's: viewers read "Lap record: Will Brown" as the fastest lap, so both are labelled.
  const fastest = timing.best.lap ? timing.cars.find((c) => Math.abs(c.bestLap - (timing.best.lap ?? 0)) < 0.0005) : undefined
  const beaten = record && timing.best.lap && timing.best.lap < record.seconds ? fastest : undefined

  return (
    <section className="race-control" aria-label="Race control">
      <h2>Race control</h2>
      {fastest && !!timing.best.lap && (
        <div className="fastest-lap">
          Fastest lap: <strong>{lapTime(timing.best.lap)}</strong> {fastest.driver} (#{fastest.carNumber}{fastest.bestLapNo ? `, lap ${fastest.bestLapNo}` : ''})
        </div>
      )}
      {record && (
        <div className={`lap-record${beaten ? ' beaten' : ''}`}>
          {beaten ? (
            <>New race lap record! Previous: {lapTime(record.seconds)}, {record.driver}</>
          ) : (
            <>Race lap record: {lapTime(record.seconds)} {record.driver} · {record.vehicle}</>
          )}
        </div>
      )}
      {messages.length === 0 ? (
        <div className="race-control-empty">No messages yet.</div>
      ) : (
        <ul>
          {messages.map((m) => (
            <li key={`${m.time}-${m.text}`} className={'served' in m ? 'served' : /penalty/i.test(m.text) ? 'penalty' : ''}
              title={'served' in m ? 'Worked out from the pit stops (Natsoft doesn\'t send this)' : undefined}>
              <span className="rc-time">{trackTime(m.time)}</span>
              <span className="rc-text">{m.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
