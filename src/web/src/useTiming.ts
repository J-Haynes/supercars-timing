import { useEffect, useState } from 'react'
import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { TimingUpdate } from './types'
import { API_BASE, HUB_PATH } from './series'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** Subscribes to the server's SignalR hub and returns the latest timing update. */
export function useTiming() {
  const [update, setUpdate] = useState<TimingUpdate | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')

  useEffect(() => {
    const hub = new HubConnectionBuilder()
      .withUrl(HUB_PATH)
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => 3000 })
      .configureLogging(LogLevel.Warning)
      .build()

    hub.on('snapshot', (u: TimingUpdate) => setUpdate(u))

    // Paint immediately from the REST snapshot while the hub connects.
    fetch(`${API_BASE}/snapshot`)
      .then((r) => (r.ok ? (r.json() as Promise<TimingUpdate>) : null))
      .then((u) => u && setUpdate((prev) => prev ?? u))
      .catch(() => {})
    hub.onreconnecting(() => setConnection('reconnecting'))
    hub.onreconnected(() => setConnection('connected'))
    hub.onclose(() => setConnection('disconnected'))

    let cancelled = false
    const start = async () => {
      while (!cancelled && hub.state === HubConnectionState.Disconnected) {
        try {
          await hub.start()
          setConnection('connected')
        } catch {
          setConnection('disconnected')
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }
    start()

    return () => {
      cancelled = true
      hub.stop()
    }
  }, [])

  return { update, connection }
}
