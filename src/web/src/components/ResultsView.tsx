import { useEffect, useState } from 'react'
import type { CarRow, LapHistory, RecordedSession, TimingSnapshot } from '../types'
import { gapText, lapTime, clock } from '../format'
import { isRace } from '../session'
import { startPosition } from '../startingGrid'
import { carPenalties } from '../penalties'
import { raceSummary } from '../raceSummary'
import { RaceCharts } from './RaceCharts'
import { PitLog } from './PitLog'
import { RaceControl } from './RaceControl'
import { Ladder } from './Ladder'

type Tab = 'classification' | 'summary' | 'charts' | 'pits' | 'control' | 'championship'

const surname = (name: string) => name.split(' ').slice(1).join(' ') || name

/**
 * A recorded session after the event: classification, and for races a summary (laps led, lead changes, safety cars,
 * movers, penalties), charts, pit stops, race control and the championship ladder. Everything is rebuilt by the
 * server from our recording (GET /api/sessions/{id}/results and /laps).
 */
export function ResultsView({ session, onLive, onReplay }: { session: RecordedSession; onLive: () => void; onReplay?: () => void }) {
  const [results, setResults] = useState<TimingSnapshot | null>(null)
  const [history, setHistory] = useState<LapHistory | null>(null)
  const [error, setError] = useState(false)
  const [tab, setTab] = useState<Tab>('classification')

  useEffect(() => {
    setResults(null); setHistory(null); setError(false); setTab('classification')
    const id = encodeURIComponent(session.id)
    fetch(`/api/sessions/${id}/results`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setResults)
      .catch(() => setError(true))
    // Lap history is optional (older servers don't have the endpoint): the charts and summary just get less.
    fetch(`/api/sessions/${id}/laps`).then((r) => (r.ok ? r.json() : null)).then(setHistory).catch(() => {})
  }, [session.id])

  const race = isRace(session.type)
  const [series, ...rest] = session.name.replace(/^\d{4}\s+/, '').split(' - ')
  const title = rest.join(' - ') || series
  const when = new Date(session.start).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })
  const tabs: [Tab, string][] = race
    ? [['classification', 'Classification'], ['summary', 'Summary'], ['charts', 'Charts'], ['pits', 'Pit stops'], ['control', 'Race control'], ['championship', 'Championship']]
    : [['classification', 'Classification'], ['charts', 'Charts'], ['control', 'Race control']]

  return (
    <section className="results">
      <div className="results-head">
        <div>
          <div className="meeting">{session.meeting.replace(/^\d{4}\s+/, '')} · {series}</div>
          <h2>{title} <span className="results-tag">Results</span></h2>
          <div className="track">{session.track} · {when}</div>
        </div>
        <div className="results-actions">
          {onReplay && <button type="button" className="back-button" onClick={onReplay}>▶ Replay</button>}
          <button type="button" className="back-button" onClick={onLive}>Back to live</button>
        </div>
      </div>

      {error && <p className="menu-muted">Couldn't load results for this session.</p>}
      {!results && !error && <p className="menu-muted">Loading results…</p>}
      {results && (
        <>
          <div className="segmented results-tabs" role="tablist">
            {tabs.map(([k, name]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{name}</button>
            ))}
          </div>
          {tab === 'classification' && <Classification results={results} race={race} />}
          {tab === 'summary' && <Summary results={results} history={history} />}
          {tab === 'charts' && (history
            ? <RaceCharts timing={results} history={history} />
            : <p className="menu-muted">No lap history for this session (it needs a server with /api/sessions/&#123;id&#125;/laps).</p>)}
          {tab === 'pits' && <PitLog timing={results} limit={500} />}
          {tab === 'control' && (results.raceControl?.length || results.session.lapRecord
            ? <RaceControl timing={results} limit={500} />
            : <p className="menu-muted">No race control messages in this session.</p>)}
          {tab === 'championship' && <Ladder timing={results} onHighlight={() => {}} />}
        </>
      )}
    </section>
  )
}

/** Final classification with positions gained, laps per driver and badges. */
function Classification({ results, race }: { results: TimingSnapshot; race: boolean }) {
  const cars = results.cars.filter((c) => c.position > 0 || c.bestLap > 0 || c.laps > 0).sort((a, b) => (a.position || 999) - (b.position || 999))
  const fastest = results.best.lap ?? null
  const shared = cars.some((c) => (c.drivers?.length ?? 0) > 1)
  const winnerLaps = cars[0]?.laps ?? 0
  return (
    <div className="tower-wrap">
      <table className="tower results-table">
        <thead>
          <tr>
            <th className="num">Pos</th>
            {race && <th className="num">+/−</th>}
            <th>Car</th>
            <th>Driver</th>
            {race ? <><th className="num primary">Laps</th><th className="num">Gap</th><th className="num">Best</th><th className="num">Pits</th></>
              : <><th className="num primary">Best</th><th className="num">Gap</th><th className="num">Laps</th></>}
            {shared && <th>Driver laps</th>}
          </tr>
        </thead>
        <tbody>
          {cars.map((c, i) => {
            const others = (c.drivers ?? []).filter((d) => d && d !== c.driver)
            const isFastest = !!fastest && Math.abs(c.bestLap - fastest) < 0.0005
            const best = <td className={`num ${isFastest ? 'session-best' : ''}${race ? '' : ' primary'}`}>{lapTime(c.bestLap) || '–'}</td>
            const start = race ? startPosition(results.session, c.carNumber) : undefined
            const change = start && c.position ? start - c.position : 0
            return (
              <tr key={c.id}>
                <td className="num pos">{c.position || '–'}</td>
                {race && <td className="num">{start ? <span className={change > 0 ? 'pos-up' : change < 0 ? 'pos-down' : 'pos-same'} title={`Started P${start}`}>{change > 0 ? `▲${change}` : change < 0 ? `▼${-change}` : '–'}</span> : ''}</td>}
                <td><span className={`car mfr-${c.manufacturer.toLowerCase()}`} title={c.vehicle}>{c.carNumber}</span></td>
                <td className="driver">
                  {c.driver}{others.length > 0 && <span className="co-driver"> / {others.join(', ')}</span>}
                  {race && isFastest && <span className="fastest-badge" title={`Fastest lap: ${lapTime(c.bestLap)}`}>⏱</span>}
                  {carPenalties(c, results).map((p, k) => <span key={k} className={`penalty-badge${p.servedAt ? ' served' : ''}`} title={`${p.what}${p.reason ? `: ${p.reason}` : ''}${p.servedAt ? ' (served)' : ''}`}>{p.kind === 'plp' ? 'PLP' : p.what.replace(/\s*seconds?/i, 's')}</span>)}
                </td>
                {race ? (
                  <>
                    <td className="num primary">{c.laps || '–'}{winnerLaps && c.laps < winnerLaps ? <span className="laps-down"> (−{winnerLaps - c.laps})</span> : ''}</td>
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
                {shared && <td className="driver-laps">{driverLapsText(c)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function driverLapsText(c: CarRow) {
  return (c.drivers ?? []).map((d, i) => `${surname(d)} ${c.driverLaps?.[i] ?? 0}`).join(' · ') + (c.unattributedLaps ? ` · +${c.unattributedLaps}?` : '')
}

/** The race in numbers: laps led, lead changes, safety cars, race time, movers, fastest stop, penalties. */
function Summary({ results, history }: { results: TimingSnapshot; history: LapHistory | null }) {
  const s = raceSummary(results, history)
  const winner = [...results.cars].sort((a, b) => (a.position || 999) - (b.position || 999))[0]
  const fastest = results.cars.find((c) => results.best.lap && Math.abs(c.bestLap - results.best.lap) < 0.0005)
  return (
    <div className="summary-grid">
      <div className="summary-card hero">
        <div className="summary-label">Winner</div>
        <div className="summary-big">#{winner?.carNumber} {winner?.drivers?.join(' / ') || winner?.driver}</div>
        <div className="summary-sub">
          {winner?.laps} laps{s.raceSeconds ? ` in ${clock(Math.round(s.raceSeconds))}` : ''}
          {fastest && <> · fastest lap {lapTime(results.best.lap)} ({fastest.driver})</>}
        </div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Laps led</div>
        {s.lapsLed.length === 0 ? <div className="menu-muted">No lap history.</div> : (
          <ul>{s.lapsLed.slice(0, 8).map((l) => <li key={`${l.carNumber}${l.driver}`}><span>#{l.carNumber} {l.driver}</span><strong>{l.laps}</strong></li>)}</ul>
        )}
        {s.lapsLed.length > 0 && <div className="summary-sub">{s.leadChanges} lead changes (at the line)</div>}
      </div>
      <div className="summary-card">
        <div className="summary-label">Safety cars</div>
        {s.cautions.length === 0 ? <div className="menu-muted">None.</div> : (
          <ul>{s.cautions.map((c, i) => (
            <li key={c.start}><span>Caution {i + 1}{c.laps ? ` · ${c.laps} ${c.laps === 1 ? 'lap' : 'laps'}` : ''}</span><strong>{c.end ? clock(Math.round(c.end - c.start)) : 'to the end'}</strong></li>
          ))}</ul>
        )}
      </div>
      <div className="summary-card">
        <div className="summary-label">Biggest movers from the grid</div>
        {s.movers.length === 0 ? <div className="menu-muted">No starting grid for this race.</div> : (
          <ul>
            {s.movers.slice(0, 4).map((m) => <li key={m.carNumber}><span>#{m.carNumber} {m.driver} <span className="menu-muted">P{m.start} → P{m.finish}</span></span><strong className="pos-up">▲{m.change}</strong></li>)}
            {s.movers.slice(-2).reverse().filter((m) => m.change < 0).map((m) => <li key={m.carNumber}><span>#{m.carNumber} {m.driver} <span className="menu-muted">P{m.start} → P{m.finish}</span></span><strong className="pos-down">▼{-m.change}</strong></li>)}
          </ul>
        )}
      </div>
      <div className="summary-card">
        <div className="summary-label">Pit lane</div>
        <ul>
          <li><span>Pit stops</span><strong>{results.cars.reduce((n, c) => n + c.pitStops, 0)}</strong></li>
          {s.fastestStop && <li><span>Fastest: #{s.fastestStop.carNumber} {surname(s.fastestStop.driver)} (lap {s.fastestStop.lap})</span><strong>{s.fastestStop.seconds.toFixed(1)}s</strong></li>}
        </ul>
      </div>
      <div className="summary-card">
        <div className="summary-label">Penalties</div>
        {s.penalties.length === 0 ? <div className="menu-muted">None.</div> : (
          <ul>{s.penalties.map((p, i) => <li key={i}><span>#{p.carNumber} {p.driver}</span><strong>{p.what}{p.served ? ' ✓' : ''}</strong></li>)}</ul>
        )}
      </div>
      {s.retirements.length > 0 && (
        <div className="summary-card">
          <div className="summary-label">Well down or retired (5+ laps)</div>
          <ul>{s.retirements.map((r) => <li key={r.carNumber}><span>#{r.carNumber} {r.driver}</span><strong>{r.laps} laps</strong></li>)}</ul>
          <div className="summary-sub">Natsoft doesn't say why a car stopped.</div>
        </div>
      )}
    </div>
  )
}
