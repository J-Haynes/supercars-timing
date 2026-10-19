import { useEffect, useState } from 'react'

/**
 * What the server lets this viewer use (GET /api/features, the same for both series). Replays are off through the
 * Cloudflare Tunnel and on locally and on the tailnet (RemoteAccess.cs on the server).
 */
export interface Features {
  replay: boolean
}

// Asked once per page load. An older server without the endpoint answers with index.html (the SPA fallback): replay
// stays on then, as it was. The server refuses replay requests through the tunnel either way.
let request: Promise<Features> | null = null
const load = () => request ??= fetch('/api/features')
  .then((r) => r.json())
  .then((f: Partial<Features>) => ({ replay: f.replay !== false }))
  .catch(() => ({ replay: true }))

/** The server's features; replay counts as off until the answer is in, so a remote viewer never sees the button. */
export function useFeatures(): Features {
  const [features, setFeatures] = useState<Features>({ replay: false })
  useEffect(() => {
    let current = true
    void load().then((f) => { if (current) setFeatures(f) })
    return () => { current = false }
  }, [])
  return features
}
