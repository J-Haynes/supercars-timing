import type { CSSProperties } from 'react'
import type { CarRow } from './types'

/**
 * Which app this page is: the Supercars app at / or the F1 app at /f1. The two share every component; the
 * server runs a separate feed for each (Natsoft at /api + /hubs/timing, F1's live timing at /api/f1 + /hubs/f1).
 * Switching series is a full page load (see SeriesSwitch), so this is fixed for the page's lifetime.
 */
export type Series = 'v8' | 'f1'

export const SERIES: Series = window.location.pathname.startsWith('/f1') ? 'f1' : 'v8'
export const isF1 = SERIES === 'f1'

/** REST base and hub for the current series. */
export const API_BASE = isF1 ? '/api/f1' : '/api'
export const HUB_PATH = isF1 ? '/hubs/f1' : '/hubs/timing'

export const SERIES_HOME: Record<Series, string> = { v8: '/', f1: '/f1' }
export const SERIES_LABEL: Record<Series, string> = { v8: 'Supercars', f1: 'F1' }

/** F1 cars are coloured by team (from F1's driver list); Supercars by manufacturer (CSS classes `mfr-*`). */
export function teamStyle(car: Pick<CarRow, 'teamColour'>, property: 'borderLeftColor' | 'fill' = 'borderLeftColor'): CSSProperties | undefined {
  return car.teamColour ? { [property]: `#${car.teamColour}` } : undefined
}
