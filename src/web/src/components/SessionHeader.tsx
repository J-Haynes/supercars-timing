import { isF1, SERIES, SERIES_HOME, SERIES_LABEL, type Series } from '../series'
// Logos: F1 from Wikimedia Commons (File:F1.svg); the Supercars "S" mark cropped from the championship logo on
// Wikipedia (File:Supercars_Championship_Logo_2021.png). Trademarks of their owners; used here for a personal app.
import f1Logo from '../assets/f1-logo.svg'
import supercarsMark from '../assets/supercars-mark.png'

const SERIES_LOGO: Record<Series, string> = { v8: supercarsMark, f1: f1Logo }
import type { FeedStatus, TimingUpdate } from '../types'
import type { ConnectionState } from '../useTiming'
import { clock } from '../format'
import { raceLaps, leaderLap } from '../session'

const FLAG_CLASS: Record<string, string> = {
  green: 'flag-green',
  yellow: 'flag-yellow',
  red: 'flag-red',
  checkered: 'flag-checkered',
  ended: 'flag-ended',
}

/** Readable names for Natsoft flags that aren't plain colours. */
const FLAG_LABEL: Record<string, string> = {
  waitstart: 'Waiting to start',
}

/** One short, human status instead of "mode · state". */
function statusText(connection: ConnectionState, feed: FeedStatus | undefined) {
  if (connection === 'connecting') return { text: 'Connecting…', dot: 'starting' }
  if (connection !== 'connected') return { text: connection === 'reconnecting' ? 'Reconnecting…' : 'Offline', dot: 'offline' }
  switch (feed?.state) {
    case 'live': return { text: 'Live', dot: 'live' }
    case 'waiting': return { text: 'Waiting for the next session', dot: 'waiting' }
    case 'error': return { text: 'Feed error', dot: 'error' }
    // The server itself is replaying a recording (development mode).
    case 'replaying': return { text: 'Server replay', dot: 'replaying' }
    case 'ended': return { text: 'Server replay ended', dot: 'waiting' }
    default: return { text: 'Connecting…', dot: 'starting' }
  }
}

/** "Lap 88 / 161" and how many to go (leaderLap: the lap the leader is on). Null when the distance is unknown. */
function lapCount(update: TimingUpdate | null) {
  const session = update?.timing.session
  const total = session ? raceLaps(session) : 0
  if (!session || total <= 0) return null
  const { lap, finished } = leaderLap(update.timing)
  if (finished) return { lap: `${lap} / ${total}`, toGo: 'Finished' }
  const toGo = total - lap + 1
  return { lap: `Lap ${lap} / ${total}`, toGo: toGo === 1 ? 'Final lap' : `${toGo} to go` }
}

/**
 * `update` is what's on screen (possibly delayed); `feed` is the live connection status.
 * With `hideSession`, a support-category session is on track: show a waiting title instead of its details.
 */
export function SessionHeader({ update: liveUpdate, feed, connection, onMenu, hideSession: hideLive, viewing }: {
  update: TimingUpdate | null
  feed: FeedStatus | undefined
  connection: ConnectionState
  /** Missing in the F1 app (the menu's results and events are Supercars only for now). */
  onMenu?: () => void
  hideSession?: boolean
  /**
   * What's on screen when it isn't live timing (a replay, results, an upcoming event): the header shows that instead,
   * with `status` in place of the feed's (e.g. "Replay · 10×"). `clock`: show its session clock (replays only).
   */
  viewing?: { update: TimingUpdate | null; status: string; clock: boolean } | null
}) {
  const update = viewing ? viewing.update : liveUpdate
  const hideSession = viewing ? false : hideLive
  const session = hideSession ? undefined : update?.timing.session
  const flag = session?.flag ?? ''
  const status = viewing ? { text: viewing.status, dot: 'replaying' } : statusText(connection, feed)
  const laps = hideSession ? null : lapCount(update)
  // Time since the green flag (race start), while the race is on.
  const greenAt = session?.greenAt ?? 0
  const finished = ['checkered', 'ended'].includes(flag.toLowerCase())
  const raceTime = laps && greenAt > 0 && !finished && update ? clock(Math.max(0, Math.floor(update.timing.now - greenAt))) : null

  return (
    <header className="session">
      <div className="session-nav">
        {onMenu && <button type="button" className="menu-button" onClick={onMenu} aria-label="Open menu">☰</button>}
        <SeriesSwitch />
      </div>
      <div className="session-title">
        <div className="meeting">{session?.meeting || update?.timing.session.meeting || (isF1 ? 'F1 Timing' : 'Supercars Timing')}</div>
        <h1>{session?.name || (hideSession ? 'Waiting for the next Supercars session' : '—')}</h1>
        {/* Always three lines, so the header keeps its height between sessions and between the two apps. */}
        <div className="track">{session?.track || '\u00A0'}</div>
      </div>
      <div className="session-status">
        {flag && <span className={`flag ${FLAG_CLASS[flag.toLowerCase()] ?? ''}`}>{FLAG_LABEL[flag.toLowerCase()] ?? flag}</span>}
        {/* Lap races: Natsoft's clock counts laps (<C Y="L" C="161">), not seconds, so the lap counter replaces it. */}
        {session && !laps && (!viewing || viewing.clock) && <div className="clock" title="Time remaining">{clock(session.clockRemaining ?? null)}</div>}
        <div className="feed"><span className={`dot dot-${status.dot}`} />{status.text}</div>
        {laps && (
          <div className="laps-to-go" title="Race distance, from the leader's laps">
            <span className="lap-of">{laps.lap}</span>
            <span className="to-go">{laps.toGo}</span>
            {raceTime && <span className="to-go" title="Time since the green flag">Race time {raceTime}</span>}
          </div>
        )}
      </div>
    </header>
  )
}

/** Master switch between the Supercars app (/) and the F1 app (/f1). Remembered for the next visit to /. */
function SeriesSwitch() {
  const choose = (s: Series) => {
    try { localStorage.setItem('supercars-timing:series', s) } catch { /* private mode: not remembered */ }
  }
  return (
    <nav className="series-switch" aria-label="Series">
      {(['v8', 'f1'] as const).map((s) => (
        <a key={s} href={SERIES_HOME[s]} className={s === SERIES ? 'active' : ''} onClick={() => choose(s)}
          title={SERIES_LABEL[s]} aria-current={s === SERIES ? 'page' : undefined}>
          <img src={SERIES_LOGO[s]} alt={SERIES_LABEL[s]} className={`series-logo series-logo-${s}`} />
        </a>
      ))}
    </nav>
  )
}
