import type { SessionInfo } from './types'

/**
 * Starting grids by car number, for positions gained/lost, entered by hand. Since 24 Oct 2026 the server sends each
 * car's grid position (F1 from F1's data; Supercars from Natsoft's order just before the start, which matched both
 * grids below exactly), so these are only needed to correct it, e.g. a penalty applied after the start order is set.
 */
const STARTING_GRIDS: { meeting: RegExp; session: RegExp; grid: Record<string, number> }[] = [
  {
    meeting: /bathurst 1000/i,
    session: /supercars championship - race 30$/i,
    grid: {
      '10': 1, '17': 2, '18': 3, '99': 4, '4': 5, '888': 6, '31': 7, '48': 8, '7': 9, '19': 10,
      '26': 11, '88': 12, '55': 13, '6': 14, '8': 15, '1': 16, '9': 17, '3': 18, '14': 19, '96': 20,
      '34': 21, '15': 22, '777': 23, '11': 24, '38': 25, '2': 26,
    },
  },
  {
    // Natsoft's order before the start (Race 31 began behind the safety car). Matches the Shootout except #888
    // Brown, 7th there and 9th here after a two-place penalty for impeding #4 Le Brocq in qualifying:
    // https://www.supercars.com/news/supercars-news-2026-will-brown-grid-penalty-gold-coast-500-impeding-incident-jack-le-brocq
    meeting: /gold coast 500/i,
    session: /supercars championship - race 31$/i,
    grid: {
      '88': 1, '1': 2, '18': 3, '8': 4, '19': 5, '55': 6, '6': 7, '26': 8, '888': 9, '2': 10,
      '17': 11, '7': 12, '10': 13, '48': 14, '96': 15, '3': 16, '4': 17, '99': 18, '14': 19, '36': 20,
      '38': 21, '9': 22, '31': 23, '11': 24,
    },
  },
]

/** Grid position for a car in this session, or undefined when we don't know the grid. */
export function startPosition(session: SessionInfo, car: { carNumber: string; gridPosition?: number }): number | undefined {
  // A grid entered by hand wins over the server's.
  const entered = STARTING_GRIDS.find((g) => g.meeting.test(session.meeting) && g.session.test(session.name))?.grid[car.carNumber]
  return entered ?? (car.gridPosition || undefined)
}
