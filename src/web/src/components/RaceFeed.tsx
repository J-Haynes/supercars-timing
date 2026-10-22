import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { TimingSnapshot } from '../types'
import { buildFeed, newMemory, type FeedEvent, type Insight } from '../insights'
import type { TowerSignals } from '../towerSignals'

const ICONS: Record<Insight['kind'], string> = {
  fastest: '⏱', lead: '🏁', penalty: '⚠', control: '📣', caution: '🚨', battle: '⚔', closing: '↗', minLaps: '⛽', mover: '⇅',
  longRun: '🔧', pace: '⚡', spread: '↔', undercut: '⤴', net: '🧮', pit: '🛞', freeStop: '✓', traffic: '🚧', penaltyImpact: '⏲',
  falloff: '📉', conditions: '🌧',
}

/** Events newer than this (Natsoft seconds) are marked NEW. */
const NEW_SECONDS = 30
/** Rows of each list shown before "more" (fewer on phones, where the feed sits above the leaderboard). */
const SHOWN = { wide: { now: 4, events: 3 }, narrow: { now: 2, events: 2 } }
const NARROW = '(max-width: 760px)'

/**
 * The race feed above the tower (insights.ts), replacing the scrolling ticker: moving text was hard to read and
 * everything looked equally important. Two parts, both still:
 * - **Log**: what happened (penalties, race control, lead changes, fastest laps, cautions), newest first, with the lap
 *   it happened on. New entries are marked NEW for 30 s.
 * - **Now**: what's going on (battles, cars closing in, fastest on track, minimum laps, movers), most important first.
 * Each list shows a few rows and expands. Hover highlights the cars in the tower and on the map; click opens the
 * driver's Focus view, or Compare for two cars.
 */
export function RaceFeed({ timing, signals, onHighlight, onOpen }: {
  timing: TimingSnapshot
  /** Undercuts and the pit-adjusted order (towerSignals.ts), shared with the tower. */
  signals?: TowerSignals
  onHighlight: (ids: string[]) => void
  /** Open the driver dialog: one car = Focus, two = Compare. */
  onOpen?: (carId: string, compareId: string | null) => void
}) {
  const memory = useRef(newMemory())
  const sessionKey = useRef('')
  const key = `${timing.session.meeting}|${timing.session.name}`
  if (sessionKey.current !== key) { memory.current = newMemory(); sessionKey.current = key }
  const feed = useMemo(() => buildFeed(timing, memory.current, signals), [timing, signals])
  const [allEvents, setAllEvents] = useState(false)
  const [allNow, setAllNow] = useState(false)
  const narrow = useMediaQuery(NARROW)
  const { now: NOW_SHOWN, events: EVENTS_SHOWN } = SHOWN[narrow ? 'narrow' : 'wide']

  if (feed.events.length === 0 && feed.now.length === 0) return null
  const events = allEvents ? feed.events : feed.events.slice(0, EVENTS_SHOWN)
  const now = allNow ? feed.now : feed.now.slice(0, NOW_SHOWN)
  const open = (i: Insight) => {
    if (!onOpen || i.carIds.length === 0 || i.carIds.length > 2) return
    onOpen(i.carIds[0], i.carIds[1] ?? null)
  }
  const itemProps = (i: Insight) => ({
    onMouseEnter: () => onHighlight(i.carIds),
    onClick: () => open(i),
    role: onOpen && i.carIds.length > 0 && i.carIds.length <= 2 ? 'button' : undefined,
    tabIndex: onOpen && i.carIds.length > 0 && i.carIds.length <= 2 ? 0 : undefined,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') open(i) },
    title: i.carIds.length === 1 ? 'Open driver focus' : i.carIds.length === 2 ? 'Compare these two cars' : undefined,
  })

  return (
    <section className="race-feed" aria-label="Race feed" onMouseLeave={() => onHighlight([])}>
      {feed.now.length > 0 && (
        <div className="feed-block">
          <div className="feed-head">
            <span className="feed-title">Now</span>
            {feed.now.length > NOW_SHOWN && (
              <button type="button" className="feed-more" onClick={() => setAllNow(!allNow)}>
                {allNow ? 'Fewer' : `+${feed.now.length - NOW_SHOWN} more`}
              </button>
            )}
          </div>
          <ul className="feed-now">
            {now.map((i) => (
              <li key={i.id} className={`feed-item tone-${i.tone}`} {...itemProps(i)}>
                <span className="feed-icon" aria-hidden>{ICONS[i.kind]}</span>
                <span className="feed-text">{i.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {feed.events.length > 0 && (
        <div className="feed-block">
          <div className="feed-head">
            <span className="feed-title">Log</span>
            {feed.events.length > EVENTS_SHOWN && (
              <button type="button" className="feed-more" onClick={() => setAllEvents(!allEvents)}>
                {allEvents ? 'Fewer' : `All ${feed.events.length}`}
              </button>
            )}
          </div>
          <ul className={`feed-log${allEvents ? ' all' : ''}`}>
            {events.map((e) => (
              <li key={e.id} className={`feed-item tone-${e.tone}${timing.now - e.at < NEW_SECONDS ? ' new' : ''}`} {...itemProps(e)}>
                <span className="feed-when" title={stampTitle(e)}>{e.lap > 0 ? `L${e.lap}` : clock(e.at)}</span>
                <span className="feed-icon" aria-hidden>{ICONS[e.kind]}</span>
                <span className="feed-text">{e.text}</span>
                {timing.now - e.at < NEW_SECONDS && <span className="feed-new">NEW</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** Whether a CSS media query matches, following changes (window resizes, phone rotation). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia?.(query).matches ?? false)
  useEffect(() => {
    const list = window.matchMedia?.(query)
    if (!list) return
    const onChange = () => setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Track time of day: Natsoft times are track-local wall clock encoded as Unix seconds, so format them as UTC. */
function clock(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 16)
}

function stampTitle(e: FeedEvent): string {
  return e.lap > 0 ? `Lap ${e.lap} (leader), ${clock(e.at)} track time` : `${clock(e.at)} track time (before this page was opened)`
}
