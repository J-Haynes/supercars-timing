import { useEffect, useMemo, useRef, useState } from 'react'
import type { LapHistory, RecordedSession, TimingSnapshot, TimingUpdate } from '../types'
import { useTrack } from '../tracks'
import { useSettings } from '../settings'
import { cautionPeriods, isRace } from '../session'
import { TimingTower } from './TimingTower'
import { TrackMap } from './TrackMap'
import { SafetyCarBanner } from './SafetyCarBanner'
import { RaceControl } from './RaceControl'
import { ErrorBoundary } from './ErrorBoundary'

const SPEEDS = [1, 2, 5, 10, 20, 60]
/** How often the page asks the server for the snapshot at the current replay time (real time). */
const POLL_MS = 250

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
export function ReplayView({ session, onBack }: { session: RecordedSession; onBack: () => void }) {
  const id = encodeURIComponent(session.id)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [laps, setLaps] = useState<LapHistory | null>(null)
  const [timing, setTiming] = useState<TimingSnapshot | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const [t, setT] = useState(0)
  const [loading, setLoading] = useState(false)
  const { settings, update: updateSettings, togglePinned } = useSettings()
  const [hoverId, setHoverId] = useState<string | null>(null)

  useEffect(() => {
    // Start 20 s before the first green flag (from the session's results) to skip the pre-race wait, else at the
    // start. Set once on load, so it never overrides a seek.
    Promise.all([
      fetch(`/api/sessions/${id}/replay/info`).then((r) => r.json()),
      fetch(`/api/sessions/${id}/results`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([info, results]: [{ start: number; end: number }, TimingSnapshot | null]) => {
      const green = results?.session.greenAt ?? 0
      setT(green > info.start ? Math.max(info.start, green - 20) : info.start)
      setRange(info)
    })
    fetch(`/api/sessions/${id}/laps`).then((r) => (r.ok ? r.json() : null)).then(setLaps).catch(() => {})
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
        const res = await fetch(`/api/sessions/${id}/replay?t=${at}&viewer=${viewerId}`)
        if (res.ok) setTiming(await res.json())
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
  const track = useTrack(timing?.session.trackCode || session.trackCode || undefined, timing?.session.track || session.track)

  // Scrubber marks: every 10th lap of the leader, and safety car periods.
  const lapMarks = useMemo(() => {
    const leader = laps?.cars.flatMap((c) => c.laps.filter((l) => l.position === 1)).sort((a, b) => a.at - b.at) ?? []
    return leader.filter((l) => l.lap % 10 === 0).map((l) => ({ lap: l.lap, at: l.at }))
  }, [laps])
  const cautions = cautionPeriods(timing?.flagHistory)
  const pct = (time: number) => (range ? ((time - range.start) / (range.end - range.start || 1)) * 100 : 0)
  const leaderLaps = timing ? Math.max(0, ...timing.cars.map((c) => c.laps)) : 0

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
        <span className="replay-time">{range ? trackTime(t) : '--:--:--'}{leaderLaps ? ` · lap ${leaderLaps}` : ''}{timing?.session.scheduledLaps ? ` / ${timing.session.scheduledLaps}` : ''}</span>
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
        <div className="layout">
          <div className="tower-column">
            {isRace(update.timing.session.type) && <SafetyCarBanner timing={update.timing} />}
            <TimingTower timing={update.timing} simple={settings.simple} columnPrefs={settings.columns} hoverId={hoverId}
              clockRate={update.feed.clockRate} pinned={settings.pinned} onHover={setHoverId} onTogglePin={togglePinned} />
          </div>
          <aside className="map-panel">
            {track ? (
              <ErrorBoundary fallback={<div className="map-missing">The track map hit an error.</div>}>
                <TrackMap track={track} update={update} hoverId={hoverId} focusId={null} pinned={settings.pinned}
                  rotation={settings.mapRotation[track.code] ?? 0}
                  onRotate={(deg) => updateSettings({ mapRotation: { ...settings.mapRotation, [track.code]: ((deg % 360) + 360) % 360 } })}
                  onHover={setHoverId} onTogglePin={togglePinned} />
              </ErrorBoundary>
            ) : <div className="map-missing">No map for this track.</div>}
            {(update.timing.raceControl?.length ?? 0) > 0 && <RaceControl timing={update.timing} />}
          </aside>
        </div>
      )}
    </section>
  )
}
