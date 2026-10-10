import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr'
import type { TimingUpdate } from './types'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** Subscribes to the server's SignalR hub and returns the latest timing update. */
export function useTiming() {
  const [update, setUpdate] = useState<TimingUpdate | null>(null)
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const hubRef = useRef<HubConnection | null>(null)

  useEffect(() => {
    const hub = new HubConnectionBuilder()
      .withUrl('/hubs/timing')
      .withAutomaticReconnect({ nextRetryDelayInMilliseconds: () => 3000 })
      .configureLogging(LogLevel.Warning)
      .build()
    hubRef.current = hub

    hub.on('snapshot', (u: TimingUpdate) => setUpdate(u))

    // Paint immediately from the REST snapshot while the hub connects.
    fetch('/api/snapshot')
      .then((r) => (r.ok ? (r.json() as Promise<TimingUpdate>) : null))
      .then((u) => u && setUpdate((prev) => prev ?? u))
      .catch(() => {})
    hub.onreconnecting(() => setConnection('reconnecting'))
    // After a reconnect the server has forgotten any replay, so the next snapshot is live.
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

  // Replay controls. The server answers with snapshots for this connection only.
  const invoke = useCallback((method: string, ...args: unknown[]) => {
    const hub = hubRef.current
    if (hub?.state === HubConnectionState.Connected) hub.invoke(method, ...args).catch((e) => console.error(method, e))
  }, [])
  const controls = {
    startReplay: (sessionId: string) => invoke('StartReplay', sessionId),
    play: (playing: boolean) => invoke('ReplayPlay', playing),
    seek: (seconds: number) => invoke('ReplaySeek', seconds),
    speed: (speed: number) => invoke('ReplaySpeed', speed),
    watchLive: () => invoke('WatchLive'),
  }

  return { update, connection, controls }
}
