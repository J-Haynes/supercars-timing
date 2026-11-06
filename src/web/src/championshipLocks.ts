import type { Standing, ChampionshipStandings } from './weekend'

/** Strict bounds: a reachable points tie stays unconfirmed. No badge means "not proven", rather than "can change". */
export function lockedPositions(rows: Standing[], data: ChampionshipStandings, teams: boolean): Set<string> {
  const remaining = data.pointsRemaining
  if (!remaining || data.note) return new Set()
  if (remaining.races === 0) return new Set(rows.filter(r => r.position > 0).map(r => r.name))
  const budget = teams ? remaining.teams : remaining.drivers
  const uncertainFinalist = (r: Standing) => !teams && remaining.driverResetsPending && r.points >= 3000
  const low = (r: Standing) => uncertainFinalist(r) ? 0 : r.points
  const high = (r: Standing) => uncertainFinalist(r) ? Math.max(r.points + budget, 5150 + 300) : r.points + budget
  return new Set(rows.filter(r => r.position > 0 && rows.every(other => other === r ||
    (other.position > 0 && other.position < r.position ? low(other) > high(r) : low(r) > high(other))))
    .map(r => r.name))
}

export interface FinalsCandidate { car: string; banked: number; total: number; wins: number; leading: boolean }

/** Candidates arrive in projected points/tie-break order. A live leader reserves a provisional win-to-advance seat. */
export function finalsQualification(rows: FinalsCandidate[], advance: number, remainingRaces: number, maxRacePoints: number,
  currentFinished = false): { through: Set<string>; secured: Map<string, 'win' | 'points'> } {
  const through = new Set(rows.filter(r => r.wins > 0 || r.leading).map(r => r.car))
  for (const row of rows) if (through.size < advance) through.add(row.car)
  const secured = new Map<string, 'win' | 'points'>()
  for (const row of rows) {
    if (row.wins > 0 || currentFinished && row.leading) { secured.set(row.car, 'win'); continue }
    if (remainingRaces === 0) {
      if (through.has(row.car)) secured.set(row.car, 'points')
      continue
    }
    const banked = currentFinished ? row.total : row.banked
    const couldBeat = rows.filter(other => other !== row && (other.wins > 0 || currentFinished && other.leading ||
      (currentFinished ? other.total : other.banked) + remainingRaces * maxRacePoints >= banked)).length
    // Even a driver unable to catch on points may win a remaining race and take a protected seat.
    const additionalWinners = Math.min(remainingRaces, rows.length - 1 - couldBeat)
    if (couldBeat + additionalWinners < advance) secured.set(row.car, 'points')
  }
  return { through, secured }
}
