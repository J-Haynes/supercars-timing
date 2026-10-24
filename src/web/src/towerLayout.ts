import { isF1 } from './series'
/**
 * Which tower columns show, and in what order. The cells themselves are defined in TimingTower.tsx (COLUMNS);
 * this module only knows the keys, so the settings panel can use it without importing the tower.
 */

export type SessionKind = 'timed' | 'race'

/** Every column, with the name shown in the settings panel. */
export const COLUMN_LABELS: Record<string, string> = {
  pos: 'Position',
  posChange: 'Positions gained/lost (races)',
  car: 'Car number',
  driver: 'Driver',
  driverLaps: 'Driver laps (co-driver events)',
  best: 'Best lap',
  gap: 'Gap',
  int: 'Interval',
  last: 'Last lap',
  s1: 'Sector 1',
  s2: 'Sector 2',
  s3: 'Sector 3',
  speed: 'Speed trap',
  pits: 'Pit stops',
  stint: 'Stint (laps since pit)',
  laps: 'Laps',
  minis: 'Micro-sectors',
  tyre: 'Tyre (F1)',
}

/** Columns that can be moved but not hidden. */
export const LOCKED_COLUMNS = ['driver']

/** Practice/qualifying ("timed") lead with Best then Gap; races lead with Gap then Int. */
const SUPERCARS_LAYOUTS: Record<SessionKind, { detailed: string[]; simple: string[] }> = {
  timed: {
    detailed: ['pos', 'car', 'driver', 'best', 'gap', 'int', 'last', 's1', 's2', 's3', 'speed', 'pits', 'laps', 'minis'],
    simple: ['pos', 'car', 'driver', 'best', 'gap', 'last', 'pits', 'laps'],
  },
  race: {
    // Driver laps next to the names: at endurance races it's what decides strategy, so keep it on screen.
    detailed: ['pos', 'posChange', 'car', 'driver', 'driverLaps', 'gap', 'int', 'last', 'best', 's1', 's2', 's3', 'speed', 'pits', 'stint', 'laps', 'minis'],
    simple: ['pos', 'posChange', 'car', 'driver', 'driverLaps', 'gap', 'int', 'last', 'pits', 'stint', 'laps'],
  },
}

/** F1: tyres instead of driver laps (one driver per car). */
const F1_LAYOUTS: Record<SessionKind, { detailed: string[]; simple: string[] }> = {
  timed: {
    detailed: ['pos', 'car', 'driver', 'best', 'gap', 'int', 'last', 's1', 's2', 's3', 'tyre', 'speed', 'pits', 'laps', 'minis'],
    simple: ['pos', 'car', 'driver', 'best', 'gap', 'last', 'tyre', 'laps'],
  },
  race: {
    detailed: ['pos', 'posChange', 'car', 'driver', 'gap', 'int', 'tyre', 'last', 'best', 's1', 's2', 's3', 'speed', 'pits', 'laps', 'minis'],
    simple: ['pos', 'posChange', 'car', 'driver', 'gap', 'int', 'tyre', 'last', 'pits', 'laps'],
  },
}

export const DEFAULT_LAYOUTS = isF1 ? F1_LAYOUTS : SUPERCARS_LAYOUTS

/** A viewer's detailed-mode layout for one session kind: every column in order, and the hidden ones. */
export interface ColumnPrefs {
  order: string[]
  hidden: string[]
}

/** The default layout's columns first, then the rest of the columns (hidden by default). */
function allColumns(kind: SessionKind): string[] {
  const defaults = DEFAULT_LAYOUTS[kind].detailed
  return [...defaults, ...Object.keys(COLUMN_LABELS).filter((k) => !defaults.includes(k))]
}

export function defaultColumnPrefs(kind: SessionKind): ColumnPrefs {
  const defaults = DEFAULT_LAYOUTS[kind].detailed
  return { order: allColumns(kind), hidden: allColumns(kind).filter((k) => !defaults.includes(k)) }
}

/**
 * Saved preferences brought up to date with the current columns: removed columns are dropped, and columns added
 * since they were saved go in after the column they follow by default (hidden unless they're a default column).
 */
export function columnPrefs(kind: SessionKind, saved: ColumnPrefs | undefined): ColumnPrefs {
  if (!saved) return defaultColumnPrefs(kind)
  const all = allColumns(kind)
  const defaults = DEFAULT_LAYOUTS[kind].detailed
  const order = saved.order.filter((k) => all.includes(k))
  const hidden = saved.hidden.filter((k) => all.includes(k) && !LOCKED_COLUMNS.includes(k))
  all.forEach((k, i) => {
    if (order.includes(k)) return
    const after = order.indexOf(all[i - 1])
    order.splice(after + 1, 0, k)
    if (!defaults.includes(k)) hidden.push(k)
  })
  return { order, hidden }
}

/** The columns to draw, in order. */
export function visibleColumns(kind: SessionKind, simple: boolean, saved: ColumnPrefs | undefined): string[] {
  if (simple) return DEFAULT_LAYOUTS[kind].simple
  const prefs = columnPrefs(kind, saved)
  return prefs.order.filter((k) => !prefs.hidden.includes(k))
}
