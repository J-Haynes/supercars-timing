import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from '../series'
import type { LapHistory, RecordedSession, TimingSnapshot, TimingUpdate } from '../types'
import { useSettings } from '../settings'
import { HideResultsSwitch, SimpleSwitch } from './Controls'
import { useHideResults } from '../spoilers'
import { flagKind, flagPeriods, leaderLap } from '../session'
import { SessionView } from './SessionView'
import type { MapFeed } from '../map/crossingLog'

const SPEEDS = [1, 2, 5, 10, 20, 60]
/** The skip buttons either side of play/pause (session seconds). */
const SKIPS = [60, 30, 10]
/** How often the page asks the server for the snapshot at the current replay time (real time). */
const POLL_MS = 250
/**
 * The map also gets the snapshot this far ahead of the replay time (session seconds), like the live feed with a
 * broadcast delay: it then knows each car's next crossing and places it between crossings instead of guessing its
 * pace (map/crossingLog.ts). Longer than the slowest stretch (Bathurst under a safety car, ~60 s).
 */
const LOOKAHEAD_SECONDS = 90
/**
 * When the lookahead jumps (loading, seeking, the skip buttons), the snapshots in between are fetched this far apart
 * (session seconds) for the map's crossing log (map/crossingLog.ts, MapFeed). Supercars stretches take 10 s+; F1
 * mini-sectors 2-5 s (a skipped one is placed across, knownPosition). A 90 s fill: ~30 snapshots of 25-40 KB, 0.6 s.
 */
const FILL_STEP = 3

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
export function ReplayView({ session, onBack, onUpdate, onSettings }: {
  session: RecordedSession
  onBack: () => void
  /** The replay's moment, for the header (App shows the replay there instead of live timing). */
  onUpdate?: (update: TimingUpdate | null) => void
  /** Opens the Settings drawer (same settings as live timing). */
  onSettings?: () => void
}) {
  const id = encodeURIComponent(session.id)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  // The whole session from its results: the green flag (the start countdown) and every flag change (the scrubber
  // shows safety cars and red flags before the replay reaches them).
  const [whole, setWhole] = useState<{ greenAt: number; flagHistory: { time: number; flag: string }[] } | null>(null)
  const [laps, setLaps] = useState<LapHistory | null>(null)
  const [timing, setTiming] = useState<TimingSnapshot | null>(null)
  const [ahead, setAhead] = useState<TimingSnapshot | null>(null)
  // Snapshots filling the latest jump in the lookahead, for the map's crossing log.
  const [between, setBetween] = useState<TimingSnapshot[] | undefined>(undefined)
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
      setWhole({ greenAt: green, flagHistory: results?.flagHistory ?? [] })
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

  // Fill a jump in the lookahead: the snapshots every FILL_STEP from `from` to `to`, on their own server cursor.
  // A newer fill replaces one still running (its first snapshots are in already: the log keeps them).
  const fillRun = useRef(0)
  const backfill = async (from: number, to: number) => {
    const run = ++fillRun.current
    const got: TimingSnapshot[] = []
    for (let at = from + FILL_STEP; at < to && run === fillRun.current; at += FILL_STEP) {
      const res = await fetch(`${API_BASE}/sessions/${id}/replay?t=${at}&viewer=${viewerId}-fill`).catch(() => null)
      if (!res?.ok) break
      const snap: TimingSnapshot = await res.json()
      snap.now = Math.max(snap.now, at)
      got.push(snap)
      // Hand them over in batches, so the earliest crossings (the ones needed first) arrive in a fraction of a second.
      if (got.length % 5 === 0 && run === fillRun.current) setBetween([...got])
    }
    if (run === fillRun.current) setBetween([...got])
  }
  const speedRef = useRef(speed)
  speedRef.current = speed
  const playingRef = useRef(playing)
  playingRef.current = playing

  // Ask for the snapshot at the current time, at most every POLL_MS, and straight away after a seek.
  const inFlight = useRef(false)
  const shownNow = useRef(0)
  const lastAsked = useRef(-1)
  const lastAhead = useRef(Number.NEGATIVE_INFINITY)
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
          // The snapshot is the state at the replay time, but its `now` is the last message's time: minutes earlier
          // where the feed went quiet (Bathurst Race 30: none from 4 min to 7 s before the start), which held the
          // session clock (map, start countdown, pit timers) back. Nothing happened in between, so it's the replay time.
          snap.now = Math.max(snap.now, at)
          if (snap.now < shownNow.current - 1) setEpoch((e) => e + 1)
          shownNow.current = snap.now
          setTiming(snap)
        }
        if (next?.ok) {
          const aheadAt = Math.min(at + LOOKAHEAD_SECONDS, range.end)
          const ahead: TimingSnapshot = await next.json()
          ahead.now = Math.max(ahead.now, aheadAt)
          setAhead(ahead)
          // More than playing would move it between two polls: a load or a seek, and the crossings in the jump were
          // never seen. Backwards, the log starts again (CrossingLog.add), so fill from the replay time.
          const from = aheadAt < lastAhead.current - 1 ? at : Math.max(lastAhead.current, at)
          const playStep = playingRef.current ? (speedRef.current * POLL_MS) / 1000 : 0
          if (aheadAt - from > Math.max(FILL_STEP, 3 * playStep)) void backfill(from, aheadAt)
          lastAhead.current = aheadAt
        }
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
  const aheadUpdate: MapFeed | null = useMemo(
    () => ahead && { feed: { mode: 'Replay', state: 'replaying', detail: session.name, clockRate: playing ? speed : 0 }, timing: ahead, between },
    [ahead, between, playing, speed, session.name])
  // Lap history up to the replay time (charts, driver dialog): nothing from later in the race.
  const shownLaps = useMemo(() => laps && timing && { ...laps, cars: laps.cars.map((c) => ({ ...c, laps: c.laps.filter((l) => l.at <= timing.now) })) },
    [laps, timing])
  // Tell the header what's on screen: only when the snapshot, play state or speed change, not every render.
  useEffect(() => { onUpdate?.(timing && { feed: { mode: 'Replay', state: 'replaying', detail: session.name, clockRate: playing ? speed : 0 }, timing }) },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onUpdate is a fresh closure each render
    [timing, playing, speed, session.name])
  useEffect(() => () => onUpdate?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps -- on leaving only

  // Hide results (spoilers.ts): the scrubber only marks what the replay has reached.
  const [hideResults, setHideResults] = useHideResults()
  const reached = (time: number) => !hideResults || time <= t
  // Scrubber marks: every 10th lap of the leader, the start and finish, and safety car and red flag periods (from the
  // whole session, so they show before the replay gets there, unless results are hidden).
  const leaderLaps = useMemo(() => laps?.cars.flatMap((c) => c.laps.filter((l) => l.position === 1)).sort((a, b) => a.at - b.at) ?? [], [laps])
  const lapMarks = leaderLaps.filter((l) => l.lap % 10 === 0).map((l) => ({ lap: l.lap, at: l.at })).filter((m) => reached(m.at))
  const lapAt = (time: number) => leaderLaps.filter((l) => l.at <= time).length + 1
  const history = whole?.flagHistory ?? timing?.flagHistory
  // With results hidden, a band still out when the replay is in it ends at the replay's moment.
  const bands = [
    ...flagPeriods(history, 'caution').map((p) => ({ ...p, kind: 'caution', label: 'Safety car / FCY' })),
    ...flagPeriods(history, 'red').map((p) => ({ ...p, kind: 'red', label: 'Red flag' })),
  ].filter((b) => reached(b.start)).map((b) => (hideResults && (b.end === undefined || b.end > t) ? { ...b, end: t } : b))
  const finish = history?.find((f) => flagKind(f.flag) === 'finished')?.time
  const finishAt = finish !== undefined && reached(finish) ? finish : undefined
  const pct = (time: number) => (range ? ((time - range.start) / (range.end - range.start || 1)) * 100 : 0)
  const seek = (seconds: number) => range && setT((now) => Math.min(Math.max(now + seconds, range.start), range.end))
  // The lap the leader is on (laps completed + 1), as the live header shows it; nothing before the start.
  const started = !!timing && (timing.session.greenAt ?? 0) > 0 && timing.now >= (timing.session.greenAt ?? 0)
  const shownLap = timing && started ? leaderLap(timing).lap : 0

  return (
    <section className="replay">
      {/* The page header already names the session ("Replay · 1×"): no second title here, the controls go straight in. */}
      <div className="replay-controls">
        <button type="button" className="back-button" onClick={onBack}>‹ Results</button>
        <div className="replay-transport">
          {SKIPS.map((s) => (
            <button key={-s} type="button" className="replay-skip" onClick={() => seek(-s)} disabled={!range} aria-label={`Back ${skipLabel(s)}`} title={`Back ${skipLabel(s)}`}>−{skipLabel(s)}</button>
          ))}
          <button type="button" className="replay-play" onClick={() => setPlaying((p) => !p)} disabled={!range} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚' : '▶'}</button>
          {[...SKIPS].reverse().map((s) => (
            <button key={s} type="button" className="replay-skip" onClick={() => seek(s)} disabled={!range} aria-label={`Forward ${skipLabel(s)}`} title={`Forward ${skipLabel(s)}`}>+{skipLabel(s)}</button>
          ))}
        </div>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Replay speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        {timing?.session.flag && <span className={`flag flag-${timing.session.flag.toLowerCase()}`}>{timing.session.flag}</span>}
        <span className="replay-time">{range ? trackTime(t) : '--:--:--'}{shownLap ? ` · lap ${shownLap}` : ''}{timing?.session.scheduledLaps ? ` / ${timing.session.scheduledLaps}` : ''}</span>
        {loading && <span className="replay-loading">loading…</span>}
        {/* Same as the live toolbar: Simple mode up front, the rest in Settings. */}
        <span className="replay-view-options">
          <SimpleSwitch simple={settings.simple} onSimple={(simple) => updateSettings({ simple })} />
          <HideResultsSwitch hide={hideResults} onHide={setHideResults} />
          {onSettings && <button type="button" className="settings-button" onClick={onSettings}>⚙ Settings</button>}
        </span>
        <div className="replay-scrubber">
          {bands.map((b) => {
            const end = b.end ?? range?.end ?? b.start
            const title = `${b.label} · ${trackTime(b.start)}–${trackTime(end)}${leaderLaps.length ? ` · from lap ${lapAt(b.start)}` : ''}`
            // A tint over the scrubber's track (under the slider, so dragging still works) and a flag above it that
            // jumps to 10 s before the flag came out.
            return (
              <span key={`${b.kind}${b.start}`}>
                <span className={`replay-band ${b.kind}`} style={{ left: `${pct(b.start)}%`, width: `max(${pct(end) - pct(b.start)}%, 3px)` }} />
                <button type="button" className={`replay-flag ${b.kind}${b.start > t ? ' ahead' : ''}`} style={{ left: `${pct(b.start)}%` }}
                  title={`${title} · click to go there`} aria-label={`${title}: go there`} onClick={() => setT(Math.max(range?.start ?? b.start, b.start - 10))}>⚑</button>
              </span>
            )
          })}
          {whole && whole.greenAt > 0 && <span className="replay-mark start" style={{ left: `${pct(whole.greenAt)}%` }} title={`Start · ${trackTime(whole.greenAt)}`} />}
          {finishAt && <span className="replay-mark finish" style={{ left: `${pct(finishAt)}%` }} title={`Chequered flag · ${trackTime(finishAt)}`} />}
          {lapMarks.map((m) => <span key={m.lap} className="replay-tick" style={{ left: `${pct(m.at)}%` }} title={`Lap ${m.lap}`}><span>{m.lap}</span></span>)}
          <input type="range" min={range?.start ?? 0} max={range?.end ?? 1} step={1} value={t} disabled={!range}
            onChange={(e) => setT(Number(e.target.value))} aria-label="Replay position" />
        </div>
      </div>

      {!update ? <p className="menu-muted">Loading replay…</p> : (
        // The same view as live timing (SessionView), so every feature is in both. Laps up to the replay time only.
        <SessionView update={update} live={aheadUpdate} settings={settings} updateSettings={updateSettings} togglePinned={togglePinned}
          history={shownLaps} resetKey={epoch} startAt={whole?.greenAt || undefined} />
      )}
    </section>
  )
}

/** 60 -> "1m", 30 -> "30s" */
function skipLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`
}
