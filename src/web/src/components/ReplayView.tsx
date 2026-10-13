import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../series'
import type { LapHistory, RecordedSession, TimingSnapshot, TimingUpdate } from '../types'
import { useSettings } from '../settings'
import { cautionPeriods, leaderLap } from '../session'
import { SessionView } from './SessionView'

const SPEEDS = [1, 2, 5, 10, 20, 60]
/** How often the page asks the server for the snapshot at the current replay time (real time). */
const POLL_MS = 250
/**
 * The map also gets the snapshot this far ahead of the replay time (session seconds), like the live feed with a
 * broadcast delay: it then knows each car's next crossing and places it between crossings instead of guessing its
 * pace (map/crossingLog.ts). Longer than the slowest stretch (Bathurst under a safety car, ~60 s).
 */
const LOOKAHEAD_SECONDS = 90

/** Natsoft time is track-local wall-clock time encoded as Unix seconds: format as UTC to get track time. */
const trackTime = (t: number) => new Date(t * 1000).toISOString().slice(11, 19)

/** A per-tab id, so the server keeps one replay cursor per viewer. */
const viewerId = (() => {
  try {
    const key = 'supercars-timing:replay-viewer'
    const id = sessionStorage.getItem(key) ?? Math.random().toString(36).slice(2)
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return Math.random().toString(36).slice(2)
  }
})()

/**
 * Replay of a recorded session: the tower, map, safety car banner and race control as they were, with play/pause,
 * speed and a scrubber (laps and safety cars marked). The server keeps a cursor per viewer (ReplayService); the page
 * moves the replay time itself and asks for the snapshot at that time a few times a second.
 */
export function ReplayView({ session, onBack, onUpdate }: {
  session: RecordedSession
  onBack: () => void
  /** The replay's moment, for the header (App shows the replay there instead of live timing). */
  onUpdate?: (update: TimingUpdate | null) => void
}) {
  const id = encodeURIComponent(session.id)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [laps, setLaps] = useState<LapHistory | null>(null)
  const [timing, setTiming] = useState<TimingSnapshot | null>(null)
  const [ahead, setAhead] = useState<TimingSnapshot | null>(null)
  // Bumped on every backwards seek, so the race feed starts again instead of keeping events from later on.
  const [epoch, setEpoch] = useState(0)
  const [playing, setPlaying] = useState(false)
  // Real time by default (the owner's choice, Oct 2026); faster speeds are in the menu.
  const [speed, setSpeed] = useState(1)
  const [t, setT] = useState(0)
  const [loading, setLoading] = useState(false)
  const { settings, update: updateSettings, togglePinned } = useSettings()

  useEffect(() => {
    // Start 20 s before the first green flag (from the session's results) to skip the pre-race wait, else at the
    // start. Set once on load, so it never overrides a seek.
    Promise.all([
      fetch(`${API_BASE}/sessions/${id}/replay/info`).then((r) => r.json()),
      fetch(`${API_BASE}/sessions/${id}/results`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([info, results]: [{ start: number; end: number }, TimingSnapshot | null]) => {
      const green = results?.session.greenAt ?? 0
      setT(green > info.start ? Math.max(info.start, green - 20) : info.start)
      setRange(info)
    })
    fetch(`${API_BASE}/sessions/${id}/laps`).then((r) => (r.ok ? r.json() : null)).then(setLaps).catch(() => {})
  }, [id])

  // Advance the replay time while playing.
  const tRef = useRef(t)
  tRef.current = t
  useEffect(() => {
    if (!playing || !range) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = Math.min(range.end, tRef.current + ((now - last) / 1000) * speed)
      last = now
      setT(next)
      if (next >= range.end) setPlaying(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, range])

  // Ask for the snapshot at the current time, at most every POLL_MS, and straight away after a seek.
  const inFlight = useRef(false)
  const shownNow = useRef(0)
  const lastAsked = useRef(-1)
  useEffect(() => {
    if (!range) return
    const ask = async () => {
      if (inFlight.current || tRef.current === lastAsked.current) return
      inFlight.current = true
      const at = tRef.current
      lastAsked.current = at
      const slow = setTimeout(() => setLoading(true), 300) // a backwards seek rebuilds from the start
      try {
        // The snapshot ahead uses its own server cursor, so the two never make each other rebuild.
        const [res, next] = await Promise.all([
          fetch(`${API_BASE}/sessions/${id}/replay?t=${at}&viewer=${viewerId}`),
          fetch(`${API_BASE}/sessions/${id}/replay?t=${Math.min(at + LOOKAHEAD_SECONDS, range.end)}&viewer=${viewerId}-ahead`).catch(() => null),
        ])
        if (res.ok) {
          const snap: TimingSnapshot = await res.json()
          if (snap.now < shownNow.current - 1) setEpoch((e) => e + 1)
          shownNow.current = snap.now
          setTiming(snap)
        }
        if (next?.ok) setAhead(await next.json())
      } finally {
        clearTimeout(slow)
        setLoading(false)
        inFlight.current = false
      }
    }
    ask()
    const iv = window.setInterval(ask, POLL_MS)
    return () => window.clearInterval(iv)
  }, [range, id])

  const update: TimingUpdate | null = timing && {
    feed: { mode: 'Replay', state: 'replaying', detail: session.name, clockRate: playing ? speed : 0 },
    timing,
  }
  // The map's "live feed": the snapshot LOOKAHEAD_SECONDS ahead, so it knows every car's next crossing.
  const aheadUpdate: TimingUpdate | null = ahead && { feed: { mode: 'Replay', state: 'replaying', detail: session.name, clockRate: playing ? speed : 0 }, timing: ahead }
  // Lap history up to the replay time (charts, driver dialog): nothing from later in the race.
  const shownLaps = useMemo(() => laps && timing && { ...laps, cars: laps.cars.map((c) => ({ ...c, laps: c.laps.filter((l) => l.at <= timing.now) })) },
    [laps, timing])
  // Tell the header what's on screen: only when the snapshot, play state or speed change, not every render.
  useEffect(() => { onUpdate?.(timing && { feed: { mode: 'Replay', state: 'replaying', detail: session.name, clockRate: playing ? speed : 0 }, timing }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUpdate is a fresh closure each render
    [timing, playing, speed, session.name])
  useEffect(() => () => onUpdate?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps -- on leaving only

  // Scrubber marks: every 10th lap of the leader, and safety car periods.
  const lapMarks = useMemo(() => {
    const leader = laps?.cars.flatMap((c) => c.laps.filter((l) => l.position === 1)).sort((a, b) => a.at - b.at) ?? []
    return leader.filter((l) => l.lap % 10 === 0).map((l) => ({ lap: l.lap, at: l.at }))
  }, [laps])
  const cautions = cautionPeriods(timing?.flagHistory)
  const pct = (time: number) => (range ? ((time - range.start) / (range.end - range.start || 1)) * 100 : 0)
  // The lap the leader is on (laps completed + 1), as the live header shows it; nothing before the start.
  const started = !!timing && (timing.session.greenAt ?? 0) > 0 && timing.now >= (timing.session.greenAt ?? 0)
  const shownLap = timing && started ? leaderLap(timing).lap : 0

  return (
    <section className="replay">
      <div className="results-head">
        <div>
          <div className="meeting">{session.meeting.replace(/^\d{4}\s+/, '')}</div>
          <h2>{session.name.split(' - ').slice(1).join(' - ') || session.name} <span className="results-tag">Replay</span></h2>
          <div className="track">{session.track}</div>
        </div>
        <button type="button" className="back-button" onClick={onBack}>Back to results</button>
      </div>

      <div className="replay-controls">
        <button type="button" className="replay-play" onClick={() => setPlaying((p) => !p)} disabled={!range} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        {timing?.session.flag && <span className={`flag flag-${timing.session.flag.toLowerCase()}`}>{timing.session.flag}</span>}
        <span className="replay-time">{range ? trackTime(t) : '--:--:--'}{shownLap ? ` · lap ${shownLap}` : ''}{timing?.session.scheduledLaps ? ` / ${timing.session.scheduledLaps}` : ''}</span>
        {loading && <span className="replay-loading">loading…</span>}
        <div className="replay-scrubber">
          {cautions.map((c) => (
            <span key={c.start} className="replay-band" style={{ left: `${pct(c.start)}%`, width: `${pct(c.end ?? range?.end ?? c.start) - pct(c.start)}%` }} title="Safety car / FCY" />
          ))}
          {lapMarks.map((m) => <span key={m.lap} className="replay-tick" style={{ left: `${pct(m.at)}%` }} title={`Lap ${m.lap}`}><span>{m.lap}</span></span>)}
          <input type="range" min={range?.start ?? 0} max={range?.end ?? 1} step={1} value={t} disabled={!range}
            onChange={(e) => setT(Number(e.target.value))} aria-label="Replay position" />
        </div>
      </div>

      {!update ? <p className="menu-muted">Loading replay…</p> : (
        // The same view as live timing (SessionView), so every feature is in both. Laps up to the replay time only.
        <SessionView update={update} live={aheadUpdate} settings={settings} updateSettings={updateSettings} togglePinned={togglePinned}
          history={shownLaps} resetKey={epoch} />
      )}
    </section>
  )
}
