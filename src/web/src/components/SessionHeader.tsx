import type { FeedStatus, TimingUpdate } from '../types'
import type { ConnectionState } from '../useTiming'
import { clock } from '../format'

const FLAG_CLASS: Record<string, string> = {
  green: 'flag-green',
  yellow: 'flag-yellow',
  red: 'flag-red',
  checkered: 'flag-checkered',
  ended: 'flag-ended',
}

/** One short, human status instead of "mode · state". */
function statusText(connection: ConnectionState, feed: FeedStatus | undefined, replaying: boolean) {
  if (connection === 'connecting') return { text: 'Connecting…', dot: 'starting' }
  if (connection !== 'connected') return { text: connection === 'reconnecting' ? 'Reconnecting…' : 'Offline', dot: 'offline' }
  if (replaying) return feed?.state === 'paused' ? { text: 'Replay paused', dot: 'waiting' } : { text: 'Replay', dot: 'replaying' }
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

/** `update` is what's on screen (possibly delayed or a replay); `feed` is the live connection status. */
export function SessionHeader({ update, feed, connection, onMenu }: {
  update: TimingUpdate | null
  feed: FeedStatus | undefined
  connection: ConnectionState
  onMenu: () => void
}) {
  const session = update?.timing.session
  const flag = session?.flag ?? ''
  const replaying = !!update?.replay
  const status = statusText(connection, replaying ? update?.feed : feed, replaying)

  return (
    <header className="session">
      <button type="button" className="menu-button" onClick={onMenu} aria-label="Open menu">☰</button>
      <div className="session-title">
        <div className="meeting">{session?.meeting || 'Supercars Timing'}</div>
        <h1>{session?.name || '—'}</h1>
        <div className="track">{session?.track}</div>
      </div>
      <div className="session-status">
        {flag && <span className={`flag ${FLAG_CLASS[flag.toLowerCase()] ?? ''}`}>{flag}</span>}
        <div className="clock" title="Time remaining">{clock(session?.clockRemaining ?? null)}</div>
        <div className="feed"><span className={`dot dot-${status.dot}`} />{status.text}</div>
      </div>
    </header>
  )
}
