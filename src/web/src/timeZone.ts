import { useSyncExternalStore } from 'react'

/**
 * Which clock session times are shown in: the viewer's own ("mine", the browser's time zone) or the track's local
 * time ("track"). One setting for the whole site, Supercars and F1 alike (series settings are stored separately),
 * shared by every component that shows times: changing it anywhere updates them all.
 */
export type TimeZoneChoice = 'mine' | 'track'

const KEY = 'supercars-timing:time-zone'
const listeners = new Set<() => void>()

function read(): TimeZoneChoice {
  try {
    return localStorage.getItem(KEY) === 'track' ? 'track' : 'mine'
  } catch {
    return 'mine' // private mode / blocked storage
  }
}

let current = read()

export function setTimeZoneChoice(choice: TimeZoneChoice) {
  current = choice
  try { localStorage.setItem(KEY, choice) } catch { /* not remembered, but still applies now */ }
  listeners.forEach((l) => l())
}

export function useTimeZoneChoice(): [TimeZoneChoice, (choice: TimeZoneChoice) => void] {
  const choice = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => current)
  return [choice, setTimeZoneChoice]
}

/** The browser's time zone, e.g. "Australia/Sydney", and its short name now in the browser's own language ("AEDT", "BST"). */
export function browserTimeZone(at = new Date()): { id: string; short: string } {
  const id = Intl.DateTimeFormat().resolvedOptions().timeZone
  const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? id
  return { id, short }
}

/**
 * Day and time of an instant, in the viewer's zone or at the track (`utcOffset` like "+10:00", fixed for the event).
 * Formatted the Australian way (Fri, 23 Oct · 11:45), in 24-hour time like the published schedules.
 */
export function formatSessionTime(at: Date, choice: TimeZoneChoice, utcOffset: string): { day: string; time: string } {
  const options: Intl.DateTimeFormatOptions = choice === 'mine' ? {} : { timeZone: 'UTC' }
  const shown = choice === 'mine' ? at : new Date(at.getTime() + offsetMinutes(utcOffset) * 60_000)
  return {
    day: new Intl.DateTimeFormat('en-AU', { ...options, weekday: 'short', day: 'numeric', month: 'short' }).format(shown),
    time: new Intl.DateTimeFormat('en-AU', { ...options, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(shown),
  }
}

/** "+10:30" -> 630, "-05:00" -> -300. */
function offsetMinutes(utcOffset: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(utcOffset)
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}
