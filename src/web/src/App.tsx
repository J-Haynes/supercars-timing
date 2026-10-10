import { useTiming } from './useTiming'
import { SessionHeader } from './components/SessionHeader'
import { TimingTower } from './components/TimingTower'

export default function App() {
  const { update, connection } = useTiming()
  const timing = update?.timing
  const hasCars = !!timing && timing.cars.length > 0

  return (
    <div className="app">
      <SessionHeader update={update} connection={connection} />
      <main>
        {hasCars ? (
          <TimingTower timing={timing} />
        ) : (
          <EmptyState state={update?.feed.state} detail={update?.feed.detail} connection={connection} />
        )}
      </main>
    </div>
  )
}

function EmptyState({ state, detail, connection }: { state?: string; detail?: string | null; connection: string }) {
  let message = 'Waiting for timing data…'
  if (connection !== 'connected') message = 'Connecting to the timing server…'
  else if (state === 'waiting') message = 'No session on track right now. Timing appears automatically when one starts.'
  else if (state === 'error') message = detail ?? 'The feed reported an error.'
  return <div className="empty">{message}</div>
}
