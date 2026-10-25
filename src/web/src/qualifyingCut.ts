import { UPCOMING, type EventSession } from './calendar'
import { isF1 } from './series'
import { isQualifying } from './session'
import type { SessionInfo } from './types'

/** The automatic qualifying cut-off: a line under `position`, and why it's there. */
export interface AutoCut {
  position: number
  /** Short label for the line, e.g. "Q1 · top 18". */
  label: string
  /** Where it came from (the line's tooltip). */
  why: string
}

/**
 * Where the cut-off line goes in a qualifying session, or null if we can't tell.
 *
 * F1: the server sends the part (Q1/Q2/Q3) and how many cars go through to the next one, from F1's own
 * TimingData (`SessionPart`, `NoEntries`: [22, 16, 10] in 2026). Exact, nothing to work out.
 *
 * Supercars: Natsoft sends nothing about it, so it comes from the format, which follows from the sessions the
 * timetable (schedule/supercars.json) lists for the race. Supercars' 2026 formats
 * (https://www.supercars.com/news/2026-supercars-championship-formats-tyres-explained-qualifying-practice-calendar-times-dates):
 * - Format 1, one qualifying session: sets the grid; at events with a Top Ten Shootout the top 10 go into it.
 * - Format 2, "two-part knockout qualifying, where the top 10 drivers from Q1 go through to Q2 to decide pole".
 * - Format 3, "three-part knockout qualifying, where six cars are knocked out in Q1, eight cars in Q2", then the
 *   Top Ten Shootout: top 18 in Q1 (24 cars, so 18 in Q2), top 10 in Q2.
 * That article isn't right round by round (it gives the Gold Coast's Race 31 Format 3; its timetable had one
 * qualifying session and a Shootout), so the timetable decides, not the article's list.
 */
export function autoCutoff(session: SessionInfo, now: number, cars: number): AutoCut | null {
  if (!isQualifying(session.name, session.type)) return null
  if (isF1) {
    const { qualifyingPart: part = 0, qualifyingCut: cut = 0 } = session
    if (cut <= 0 || cut >= cars) return null
    return { position: cut, label: `Q${part} · top ${cut}`, why: `F1's timing: the top ${cut} go through to Q${part + 1}` }
  }
  return supercarsCut(session, now, cars)
}

function supercarsCut(session: SessionInfo, now: number, cars: number): AutoCut | null {
  // "2026 Repco Supercars Championship - Qualifying Race 31": the race number links the session to the timetable.
  const name = session.name.split(' - ').at(-1) ?? session.name
  const raceNo = /race\s*(\d+)/i.exec(name)?.[1]
  const event = UPCOMING.find((e) => session.meeting.toLowerCase().includes(e.name.toLowerCase()))
  if (!raceNo || !event?.sessions) return null
  const forRace = event.sessions.filter((s) => new RegExp(`\\(race ${raceNo}\\)`, 'i').test(s.name))
  const quali = forRace.filter((s) => /qualif/i.test(s.name))
  const shootout = forRace.some((s) => /shoot\s*-?out|top\s*(10|ten)/i.test(s.name))
  if (quali.length === 0) return null

  const fit = (position: number, label: string, why: string): AutoCut | null =>
    position < cars ? { position, label, why } : null

  if (quali.length === 1) {
    // Format 1: the top 10 go into the Shootout if there is one; otherwise this session is the grid.
    return shootout ? fit(10, 'Shootout · top 10', 'Top 10 go through to the Top Ten Shootout (timetable)') : null
  }

  // Two or three parts: which one is this? Natsoft's name hasn't been seen for these yet, so its number
  // ("Qualifying 1", "Q1", "Qualifying Part 2"), else the timetable session the clock is in.
  const part = partFromName(name) ?? partFromClock(quali, now)
  if (part === null) return null
  if (!shootout) {
    // Format 2: the top 10 from Q1 go through to Q2, which decides pole.
    return part === 1 ? fit(10, 'Q1 · top 10', 'Top 10 go through to Q2 (Supercars Format 2: timetable has Q1 and Q2)') : null
  }
  // Format 3: six out in Q1, eight in Q2, the last 10 into the Shootout.
  // 18 go through, not "cars - 6": the snapshot only lists cars as they come out (10 of 24 at Race 32's green), and
  // Q2 is 18 cars either way (eight out, ten into the Shootout).
  if (part === 1) return fit(18, 'Q1 · top 18', 'Top 18 go through to Q2 (Supercars Format 3: Q1, Q2, Top Ten Shootout)')
  if (part === 2) return fit(10, 'Q2 · top 10', 'Top 10 go through to the Top Ten Shootout (Supercars Format 3)')
  return null
}

function partFromName(name: string): number | null {
  const m = /(?:qualif\w*|\bq)\s*(?:part\s*)?([123])\b/i.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * The qualifying part on the clock: the last one that's due to have started, while it's within 30 min of its
 * scheduled end (sessions run late). Only the first part counts from 10 min early (the feed opens a session before
 * its green; Natsoft named Race 32's "Qualifying Race 32", no part, from 11:19 for an 11:20 Q1): a later part waits
 * for its own start, since the one before can still be running (Gold Coast Q1 ended 11:32, Q2 started 11:40).
 */
function partFromClock(quali: EventSession[], now: number): number | null {
  const at = (local: string) => Date.parse(`${local}:00Z`) / 1000 // track-local time, like the feed's `now`
  let i = -1
  quali.forEach((s, k) => { if (now >= at(s.start) - (k === 0 ? 600 : 0)) i = k })
  const end = quali[i]?.end
  return i >= 0 && end && now <= at(end) + 1800 ? i + 1 : null
}

/** Which session a viewer's own line belongs to. It includes the part, so a line moved in Q1 doesn't carry into Q2. */
export function cutoffKey(session: SessionInfo, auto: AutoCut | null): string {
  return [session.meeting, session.name, session.qualifyingPart ?? 0, auto?.label ?? ''].join('|')
}
