import type { TimingUpdate } from '../types'
import type { ConnectionState } from '../useTiming'
import { clock } from '../format'

const FLAG_CLASS: Record<string, string> = {
  green: 'flag-green',
  yellow: 'flag-yellow',
  red: 'flag-red',
  checkered: 'flag-checkered',
  ended: 'flag-ended',
}

export function SessionHeader({ update, connection }: { update: TimingUpdate | null; connection: ConnectionState }) {
  const session = update?.timing.session
  const feed = update?.feed
  const flag = session?.flag ?? ''

  return (
    <header className="session">
      <div className="session-title">
        <div className="meeting">{session?.meeting || 'Supercars Timing'}</div>
        <h1>{session?.name || '—'}</h1>
        <div className="track">{session?.track}</div>
      </div>
      <div className="session-status">
        {flag && <span className={`flag ${FLAG_CLASS[flag.toLowerCase()] ?? ''}`}>{flag}</span>}
        <div className="clock" title="Time remaining">{clock(session?.clockRemaining ?? null)}</div>
        <div className="feed">
          <span className={`dot dot-${connection === 'connected' ? feed?.state ?? 'starting' : 'offline'}`} />
          {connection !== 'connected' ? connection : feed ? `${feed.mode} · ${feed.state}` : '…'}
        </div>
      </div>
    </header>
  )
}
