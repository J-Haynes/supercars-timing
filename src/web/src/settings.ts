import { isF1 } from './series'
import { useCallback, useEffect, useState } from 'react'
import type { ColumnPrefs, SessionKind } from './towerLayout'

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
  /** The 3D map (TrackMap3D, the default) or the flat map. Named mapView, not the earlier mapMode, so browsers that
   * saved mapMode: '2d' while 2D was the default start in 3D. */
  mapView: '3d' | '2d'
  /** Map column width in px on wide screens (dragged with ColumnSplitter); null = automatic. */
  mapWidth: number | null
  /** 3D map camera: still (the default "3D" view), turning slowly around the track, or chasing `followCar`. Named
   * camera3d, not the earlier mapCamera, so browsers that saved 'orbit' start on the new default. */
  camera3d: 'static' | 'orbit' | 'follow' | 'free'
  /** 3D map: buildings drawn as flat footprints instead of blocks. */
  flatBuildings: boolean
  /** Corner names and numbers on the maps (the Corners button). */
  cornerLabels: boolean
  /** Battles (cars within a second) highlighted on the maps during races (the Battles button). */
  showBattles: boolean
  /** Car number the 3D camera follows (null: the leader). */
  followCar: string | null
  /** Detailed-mode tower columns (order and hidden), per session kind. Missing = the default layout. */
  columns: Partial<Record<SessionKind, ColumnPrefs>>
}

// Each series keeps its own settings (column layouts differ).
const KEY = isF1 ? 'supercars-timing:f1-settings' : 'supercars-timing:settings'
const DEFAULTS: Settings = { simple: false, delay: 0, pinned: [], tipDismissed: false, mapRotation: {}, mapView: '3d', mapWidth: null, camera3d: 'static', flatBuildings: false, cornerLabels: true, showBattles: true, followCar: null, focusCard: 'auto', columns: {} }

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
