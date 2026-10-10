import { useEffect, useState } from 'react'
import type { RecordedSession, TimingSnapshot } from '../types'
import { gapText, lapTime } from '../format'
import { isRace } from '../session'

/** Final classification of a recorded session. */
export function ResultsView({ session, onLive }: { session: RecordedSession; onLive: () => void }) {
  const [results, setResults] = useState<TimingSnapshot | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    setResults(null)
    setError(false)
    fetch(`/api/sessions/${encodeURIComponent(session.id)}/results`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setResults)
      .catch(() => setError(true))
  }, [session.id])

  const race = isRace(session.type)
  const [series, ...rest] = session.name.replace(/^\d{4}\s+/, '').split(' - ')
  const title = rest.join(' - ') || series
  const when = new Date(session.start).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
  const cars = (results?.cars ?? []).filter((c) => c.position > 0 || c.bestLap > 0 || c.laps > 0)
  const fastest = results?.best.lap ?? null

  return (
    <section className="results">
      <div className="results-head">
        <div>
          <div className="meeting">{session.meeting.replace(/^\d{4}\s+/, '')} · {series}</div>
          <h2>{title} <span className="results-tag">Results</span></h2>
          <div className="track">{session.track} · {when}</div>
        </div>
        <button type="button" className="back-button" onClick={onLive}>Back to live</button>
      </div>

      {error && <p className="menu-muted">Couldn't load results for this session.</p>}
      {!results && !error && <p className="menu-muted">Loading results…</p>}
      {results && (
        <div className="tower-wrap">
          <table className="tower results-table">
            <thead>
              <tr>
                <th className="num">Pos</th>
                <th>Car</th>
                <th>Driver</th>
                {race ? <><th className="num primary">Laps</th><th className="num">Gap</th><th className="num">Best</th><th className="num">Pits</th></>
                  : <><th className="num primary">Best</th><th className="num">Gap</th><th className="num">Laps</th></>}
              </tr>
            </thead>
            <tbody>
              {cars.map((c, i) => {
                const others = (c.drivers ?? []).filter((d) => d && d !== c.driver)
                const best = <td className={`num ${fastest && Math.abs(c.bestLap - fastest) < 0.0005 ? 'session-best' : ''}${race ? '' : ' primary'}`}>{lapTime(c.bestLap) || '–'}</td>
                return (
                  <tr key={c.id}>
                    <td className="num pos">{c.position || '–'}</td>
                    <td><span className={`car mfr-${c.manufacturer.toLowerCase()}`} title={c.vehicle}>{c.carNumber}</span></td>
                    <td className="driver">{c.driver}{others.length > 0 && <span className="co-driver"> / {others.join(', ')}</span>}</td>
                    {race ? (
                      <>
                        <td className="num primary">{c.laps || '–'}</td>
                        <td className="num">{gapText(c.gap, c.gapLaps, i === 0)}</td>
                        {best}
                        <td className="num">{c.pitStops || ''}</td>
                      </>
                    ) : (
                      <>
                        {best}
                        <td className="num">{c.bestLap > 0 ? gapText(c.gap, c.gapLaps, i === 0) : ''}</td>
                        <td className="num">{c.laps || ''}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
