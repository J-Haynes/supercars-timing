import { isF1 } from './series'
import { useCallback, useSyncExternalStore } from 'react'
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
  /** The map's height in px, from the grip under it (MapHeightHandle); null = the default. */
  mapHeight: number | null
  /** 3D map camera: still (the default "3D" view), turning slowly around the track, or chasing `followCar`. Named
   * camera3d, not the earlier mapCamera, so browsers that saved 'orbit' start on the new default. */
  camera3d: 'static' | 'orbit' | 'follow' | 'free'
  /** 3D map: buildings drawn as flat footprints instead of blocks. */
  flatBuildings: boolean
  /** Corner names and numbers on the maps (the Corners button). */
  cornerLabels: boolean
  /** Battles (cars within a second) highlighted on the maps during races (the Battles button). */
  showBattles: boolean
  /** 3D map: names of landmarks (attractions, stadiums, tall buildings) shown (the Landmarks button). */
  showLandmarks: boolean
  /** Car number whose "if it pitted now" rejoin is shown on the maps (pit/: an experimental estimate); null = off. */
  pitGhostCar: string | null
  /** Car number the 3D camera follows (null: the leader). */
  followCar: string | null
  /** Qualifying cut-off lines in the tower: where qualifyingCut.ts works them out (F1's feed, Supercars' timetable),
   * or none at all. Replaced a single saved position (qualifyingCut), which was wrong for most sessions. */
  cutoffLines: 'auto' | 'off'
  /** The viewer's own line for one session (dragged in the tower); a new session goes back to automatic. */
  cutoffOverride: CutoffOverride | null
  /** Gold badge on the car numbers of drivers still in the Finals (Supercars Finals rounds). */
  finalistBadges: boolean
  /** Detailed-mode tower columns (order and hidden), per session kind. Missing = the default layout. */
  columns: Partial<Record<SessionKind, ColumnPrefs>>
}

/** A cut-off line the viewer moved: which session (`cutoffKey`) and the position (0 = removed). */
export interface CutoffOverride {
  session: string
  position: number
}

// Each series keeps its own settings (column layouts differ).
const KEY = isF1 ? 'supercars-timing:f1-settings' : 'supercars-timing:settings'
const DEFAULTS: Settings = { simple: false, delay: 0, pinned: [], tipDismissed: false, mapRotation: {}, mapView: '3d', mapWidth: null, mapHeight: null, camera3d: 'static', flatBuildings: false, cornerLabels: true, showBattles: true, showLandmarks: true, pitGhostCar: null, followCar: null, focusCard: 'auto', cutoffLines: 'auto', cutoffOverride: null, finalistBadges: true, columns: {} }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS // private mode / blocked storage: just don't remember
  }
}

// One copy of the settings for the whole page. Each component used to keep its own (App, the replay, results, event
// pages): a change made in one never reached the others (Settings opened from a replay didn't change the replay's
// tower), and each saved its whole copy, so a stale one could undo another's change.
let current: Settings = load()
const listeners = new Set<() => void>()

function save(next: Settings) {
  current = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, () => current)
  const update = useCallback((patch: Partial<Settings>) => save({ ...current, ...patch }), [])
  const togglePinned = useCallback(
    (carNumber: string) =>
      save({
        ...current,
        pinned: current.pinned.includes(carNumber) ? current.pinned.filter((n) => n !== carNumber) : [...current.pinned, carNumber],
      }),
    [],
  )

  return { settings, update, togglePinned }
}
