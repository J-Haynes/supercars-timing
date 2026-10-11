import type { SessionInfo } from './types'

/**
 * Starting grids by car number, for positions gained/lost. A stopgap until the server sends each car's grid
 * position: this was taken from our own recording (Natsoft's order just before the green flag), so it could be
 * added without restarting the server mid-race. Top ten matches the Top Ten Shootout result.
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
]

/** Grid position for a car in this session, or undefined when we don't know the grid. */
export function startPosition(session: SessionInfo, car: { carNumber: string; gridPosition?: number }): number | undefined {
  // F1 sends grid positions; Supercars grids are entered by hand below.
  if (car.gridPosition) return car.gridPosition
  return STARTING_GRIDS.find((g) => g.meeting.test(session.meeting) && g.session.test(session.name))?.grid[car.carNumber]
}
