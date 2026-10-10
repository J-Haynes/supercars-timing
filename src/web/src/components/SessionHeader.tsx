import type { FeedStatus, TimingUpdate } from '../types'
import type { ConnectionState } from '../useTiming'
import { clock } from '../format'
import { raceLaps } from '../session'

const FLAG_CLASS: Record<string, string> = {
  green: 'flag-green',
  yellow: 'flag-yellow',
  red: 'flag-red',
  checkered: 'flag-checkered',
  ended: 'flag-ended',
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

/** "Lap 88 / 161" and how many to go, from the leader's completed laps. Null when the distance is unknown. */
function lapCount(update: TimingUpdate | null) {
  const session = update?.timing.session
  const total = session ? raceLaps(session) : 0
  if (!session || total <= 0) return null
  const leader = update.timing.cars.find((c) => c.position === 1) ?? update.timing.cars[0]
  const done = leader?.laps ?? 0
  const flag = session.flag.toLowerCase()
  if (done >= total || flag === 'checkered' || flag === 'ended') return { lap: `${Math.min(done, total)} / ${total}`, toGo: 'Finished' }
  const toGo = total - done
  return { lap: `Lap ${Math.min(done + 1, total)} / ${total}`, toGo: toGo === 1 ? 'Final lap' : `${toGo} to go` }
}

/**
 * `update` is what's on screen (possibly delayed); `feed` is the live connection status.
 * With `hideSession`, a support-category session is on track: show a waiting title instead of its details.
 */
export function SessionHeader({ update, feed, connection, onMenu, hideSession }: {
  update: TimingUpdate | null
  feed: FeedStatus | undefined
  connection: ConnectionState
  onMenu: () => void
  hideSession?: boolean
}) {
  const session = hideSession ? undefined : update?.timing.session
  const flag = session?.flag ?? ''
  const status = statusText(connection, feed)
  const laps = hideSession ? null : lapCount(update)

  return (
    <header className="session">
      <button type="button" className="menu-button" onClick={onMenu} aria-label="Open menu">☰</button>
      <div className="session-title">
        <div className="meeting">{session?.meeting || update?.timing.session.meeting || 'Supercars Timing'}</div>
        <h1>{session?.name || (hideSession ? 'Waiting for the next Supercars session' : '—')}</h1>
        <div className="track">{session?.track}</div>
      </div>
      <div className="session-status">
        {flag && <span className={`flag ${FLAG_CLASS[flag.toLowerCase()] ?? ''}`}>{flag}</span>}
        {session && <div className="clock" title="Time remaining">{clock(session.clockRemaining ?? null)}</div>}
        <div className="feed"><span className={`dot dot-${status.dot}`} />{status.text}</div>
        {laps && (
          <div className="laps-to-go" title="Race distance, from the leader's laps">
            <span className="lap-of">{laps.lap}</span>
            <span className="to-go">{laps.toGo}</span>
          </div>
        )}
      </div>
    </header>
  )
}
