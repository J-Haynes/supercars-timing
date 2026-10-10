import { useCallback, useEffect, useState } from 'react'

/** Per-viewer preferences, remembered in this browser. */
export interface Settings {
  /** Fewer columns: the essentials only. */
  simple: boolean
  /** Seconds to hold data back so it lines up with a delayed TV/stream broadcast. */
  delay: number
  /** Car numbers the viewer has highlighted (double-click). Car numbers are stable across sessions. */
  pinned: string[]
  tipDismissed: boolean
  /** On-track (Shootout) card: auto = only in Shootout sessions. */
  focusCard: 'auto' | 'on' | 'off'
  /** Map rotation in degrees, per Natsoft track code. */
  mapRotation: Record<string, number>
}

const KEY = 'supercars-timing:settings'
const DEFAULTS: Settings = { simple: false, delay: 0, pinned: [], tipDismissed: false, mapRotation: {}, focusCard: 'auto' }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS // private mode / blocked storage: just don't remember
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
  }, [settings])

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), [])
  const togglePinned = useCallback(
    (carNumber: string) =>
      setSettings((s) => ({
        ...s,
        pinned: s.pinned.includes(carNumber) ? s.pinned.filter((n) => n !== carNumber) : [...s.pinned, carNumber],
      })),
    [],
  )

  return { settings, update, togglePinned }
}
