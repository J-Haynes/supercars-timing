import { useState, type KeyboardEvent } from 'react'
import type { UpcomingEvent } from '../calendar'
import { formatSessionTime, type TimeZoneChoice } from '../timeZone'
import { coverageLabel, weekendSessions, type Coverage, type WeekendData, type Standing } from '../weekend'
import { useStandings } from '../useWeekend'
import { lockedPositions } from '../championshipLocks'

/** Existing segmented buttons with the keyboard/focus behaviour of an accessible tab list. */
export function EventTabs<T extends string>({ id, items, tab, onTab, label }: {
  id: string; items: readonly (readonly [T, string])[]; tab: T; onTab: (tab: T) => void; label: string
}) {
  function keys(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = e.key === 'ArrowRight' ? (index + 1) % items.length : e.key === 'ArrowLeft'
      ? (index + items.length - 1) % items.length : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    onTab(items[next][0])
    document.getElementById(`${id}-tab-${items[next][0]}`)?.focus()
  }
  return <div className="segmented event-tabs" role="tablist" aria-label={label}>
    {items.map(([key, name], i) => <button key={key} id={`${id}-tab-${key}`} type="button" role="tab"
      aria-controls={`${id}-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
      className={tab === key ? 'active' : ''} onClick={() => onTab(key)} onKeyDown={e => keys(e, i)}>{name}</button>)}
  </div>
}

/** Includes the end date when a programme crosses midnight in the chosen time zone. */
export function WeekendTime({ start, end, event, zone }: { start: string; end?: string | null; event: UpcomingEvent; zone: TimeZoneChoice }) {
  const from = formatSessionTime(new Date(start), zone, event.utcOffset)
  const to = end ? formatSessionTime(new Date(end), zone, event.utcOffset) : null
  return <span className="weekend-time"><time dateTime={start}>{from.day} · {from.time}</time>
    {to && <> – <time dateTime={end!}>{to.day === from.day ? to.time : `${to.day} · ${to.time}`}</time></>}</span>
}

export function CoverageDetails({ coverage, event, zone }: { coverage?: Coverage | null; event: UpcomingEvent; zone: TimeZoneChoice }) {
  return <div className="coverage-details">
    <span className={`coverage-status ${coverage?.status === 'confirmed' ? 'confirmed' : 'unconfirmed'}`}>{coverageLabel(coverage)}</span>
    <span>{coverage?.channels.length ? `${coverage.status === 'unconfirmed' ? 'Expected: ' : ''}${coverage.channels.join(' / ')}` : 'Channels unconfirmed'}</span>
    <span>{coverage?.scope === 'day' ? 'Day’s coverage' : 'Broadcast'}: {coverage?.start ? <WeekendTime start={coverage.start} end={coverage.end} event={event} zone={zone} /> : 'start unconfirmed'}</span>
    {coverage?.scope === 'day' && <small>Individual programme start unconfirmed</small>}
    {coverage?.note && <small>{coverage.note}</small>}
    {coverage?.source && <a href={coverage.source} target="_blank" rel="noreferrer">Coverage source</a>}
    {coverage?.checkedAt && <small>Coverage checked {new Date(coverage.checkedAt).toLocaleString()}</small>}
  </div>
}

export function WeekendTimetable({ event, weekend, zone, now }: { event: UpcomingEvent; weekend: WeekendData | null; zone: TimeZoneChoice; now: number }) {
  const [category, setCategory] = useState('all')
  const sessions = weekendSessions(event, weekend)
  const categories = [...new Set(sessions.map(s => s.category))]
  return <>
    <h3>Weekend timetable</h3>
    <label className="weekend-filter">Category <select value={category} onChange={e => setCategory(e.target.value)}>
      <option value="all">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}
    </select></label>
    {!weekend && <p className="chart-note">Support-category timetable unconfirmed. Published main championship sessions are shown.</p>}
    <div className="weekend-sessions">
      {sessions.filter(s => category === 'all' || s.category === category).map(s => <article
        className={`weekend-session${s.end && Date.parse(s.end) <= now ? ' done' : ''}`} key={`${s.category}/${s.start}/${s.name}`}>
        <div className="weekend-session-head"><span>{s.category}</span><b>{s.name}</b>
          <WeekendTime start={s.start} end={s.end} event={event} zone={zone} />{!s.end && <small>End time unconfirmed</small>}</div>
        <CoverageDetails coverage={s.coverage} event={event} zone={zone} />
      </article>)}
    </div>
    {sessions.length === 0 && <p>The session timetable has not been published yet.</p>}
    <WeekendSource weekend={weekend} />
  </>
}

export function BroadcastTimetable({ event, weekend, zone }: { event: UpcomingEvent; weekend: WeekendData | null; zone: TimeZoneChoice }) {
  return <>
    <h3>Australian TV coverage</h3>
    <p className="chart-note">Kayo / Foxtel listings, displayed in your selected time zone. Coverage starts can include build-up and support categories.</p>
    {weekend?.broadcasts.length ? weekend.broadcasts.map(b => <article className="weekend-broadcast" key={`${b.start}/${b.title}`}>
      <b>{b.title}</b><WeekendTime start={b.start} end={b.end} event={event} zone={zone} />
      <span>{b.channels.join(' / ')}</span><a href={b.source} target="_blank" rel="noreferrer">Listing source</a>
      {!b.end && <small className="chart-note">Broadcast end time unconfirmed</small>}
      {b.checkedAt && <small className="chart-note">Listing checked {new Date(b.checkedAt).toLocaleString()}</small>}
    </article>) : <p>No programme start times have been confirmed for this weekend.</p>}
    <p className="chart-note">The Weekend timetable tab shows coverage confirmation for each session. A session falling inside a broadcast block does not establish that it will be televised. Unlisted coverage is unconfirmed.</p>
    <WeekendSource weekend={weekend} />
  </>
}

function WeekendSource({ weekend }: { weekend: WeekendData | null }) {
  if (!weekend) return null
  return <div className="chart-note">
    {weekend.note && <p role="status">{weekend.note}</p>}
    <p><a href={weekend.scheduleSource} target="_blank" rel="noreferrer">Published timetable</a> · Schedule checked {new Date(weekend.checkedAt).toLocaleString()} · Times may change.</p>
  </div>
}

export function ChampionshipPanel({ season }: { season: number }) {
  const standings = useStandings(season)
  const [tab, setTab] = useState<'drivers' | 'teams'>('drivers')
  return <>
    <h3>{season} championship standings</h3>
    <EventTabs id="championship" label="Championship standings" tab={tab} onTab={setTab} items={[
      ['drivers', 'Drivers'], ['teams', 'Teams / constructors'],
    ]} />
    {(['drivers', 'teams'] as const).map(section => <section key={section} id={`championship-panel-${section}`} role="tabpanel"
      aria-labelledby={`championship-tab-${section}`} hidden={tab !== section} tabIndex={0}>
      {standings ? <>
        <p className="chart-note">Latest published championship points · {standings.asOf}. These are championship standings, separate from session results.</p>
        {standings.note && <p role="status">{standings.note}</p>}
        <StandingsTable rows={standings[section]} drivers={section === 'drivers'} locked={lockedPositions(standings[section], standings, section === 'teams')} />
        {standings.pointsRemaining ? <p className="chart-note">🔒 Position locked means the exact championship position cannot change on remaining points.
          At most {section === 'drivers' ? standings.pointsRemaining.drivers : standings.pointsRemaining.teams} points remain across {standings.pointsRemaining.races} races{standings.pointsRemaining.sprints ? ` and ${standings.pointsRemaining.sprints} Sprints` : ''}.
          {standings.pointsRemaining.driverResetsPending && section === 'drivers' ? ' Finals resets/elimination are still possible; uncertain cases are not marked.' : ' Reachable points ties are not marked.'} Based on published points, before later penalties. <a href={standings.pointsRemaining.source} target="_blank" rel="noreferrer">Scoring rules</a></p>
          : <p className="chart-note">Position locks are unconfirmed until the remaining points schedule is verified.</p>}
        <p className="chart-note"><a href={section === 'drivers' ? standings.driversSource : standings.teamsSource} target="_blank" rel="noreferrer">Standings source</a> · Checked {new Date(standings.checkedAt).toLocaleString()}.</p>
      </> : <p>Championship standings are unavailable for this season.</p>}
    </section>)}
  </>
}

function StandingsTable({ rows, drivers, locked }: { rows: Standing[]; drivers: boolean; locked: Set<string> }) {
  return <div className="weekend-table-scroll"><table className="event-table championship-table">
    <thead><tr><th scope="col">Pos</th><th scope="col">{drivers ? 'Driver' : 'Team / constructor'}</th>
      {drivers && <th scope="col">Team</th>}<th scope="col">Points</th></tr></thead>
    <tbody>{rows.map(r => <tr key={`${r.position}/${r.name}`}><td className="num">{r.position || '—'}</td><th scope="row">{r.name}{locked.has(r.name) && <span className="position-lock">🔒 Locked P{r.position}</span>}</th>
      {drivers && <td>{r.team}</td>}<td className="num">{r.points}</td></tr>)}</tbody>
  </table></div>
}
