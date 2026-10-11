import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TimingSnapshot } from '../types'
import { buildInsights, newMemory, type Insight } from '../insights'

const ICONS: Record<Insight['kind'], string> = {
  fastest: '⏱', lead: '🏁', penalty: '⚠', control: '📣', caution: '🚨', battle: '⚔', closing: '↗', minLaps: '⛽', mover: '⇅', longRun: '🔧',
}

/** Scroll speed, pixels per second. */
const SPEED = 45
/** Space between items (matches .insights-scroll > .insight margin-right). */
const GAP = 10

interface Slot { key: number; id: string }

/**
 * Scrolling strip of race insights above the tower (insights.ts), working like a news ticker: items enter on the
 * right and leave on the left. An item is only removed once it has scrolled fully out of view, and the scroll
 * position moves back by exactly its width at that moment, so nothing on screen ever jumps. New items, and
 * changes to which insights exist, just join the queue on the right; text of items in view stays live.
 * (The first version scrolled two copies with a CSS animation sized to the text, and jumped whenever an insight
 * appeared, went or changed a number; measured at up to 18 px in one 50 ms step.)
 * It pauses while hovered; hovering an item highlights its cars in the tower and on the map.
 */
export function InsightsTicker({ timing, onHighlight }: { timing: TimingSnapshot; onHighlight: (ids: string[]) => void }) {
  const memory = useRef(newMemory())
  const sessionKey = useRef('')
  const key = `${timing.session.meeting}|${timing.session.name}`
  if (sessionKey.current !== key) { memory.current = newMemory(); sessionKey.current = key }
  const latest = useMemo(() => buildInsights(timing, memory.current), [timing])

  // Last known version of every insight, so an item already queued keeps its text after the insight goes.
  const known = useRef(new Map<string, Insight>())
  for (const i of latest) known.current.set(i.id, i)
  const latestRef = useRef(latest)
  latestRef.current = latest

  const [queue, setQueue] = useState<Slot[]>([])
  const queueRef = useRef(queue)
  queueRef.current = queue
  const nextIndex = useRef(0)
  const nextKey = useRef(0)
  /** The next insight in rotation (cycles through the current list), or null if there are none. */
  const next = (): Slot | null => {
    const list = latestRef.current
    if (list.length === 0) return null
    const id = list[nextIndex.current % list.length].id
    nextIndex.current++
    return { key: nextKey.current++, id }
  }

  const track = useRef<HTMLDivElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const offset = useRef(0)
  const paused = useRef(false)
  const waiting = useRef(false) // a queue change is waiting to render; don't measure until it has
  useLayoutEffect(() => {
    // Removing the first item moved everything left by its width: the offset was reduced to match before the
    // render, so apply it now, in the same frame as the new layout.
    if (scroll.current) scroll.current.style.transform = `translateX(${-offset.current}px)`
    waiting.current = false
  }, [queue])

  const reduceMotion = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  useEffect(() => {
    if (reduceMotion) return
    let frame = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000) // cap, so a background tab doesn't leap ahead
      last = t
      const el = scroll.current
      const box = track.current
      if (el && box && !waiting.current) {
        if (!paused.current) offset.current += SPEED * dt
        const first = el.firstElementChild as HTMLElement | null
        const width = first ? first.offsetWidth + GAP : 0
        if (first && offset.current >= width) {
          // The first item is fully out of view on the left: drop it and step back by its width. The new position
          // is applied by the layout effect, in the same frame as the item leaves the page; applying it here
          // would draw the old content shifted right by its width for a frame.
          offset.current -= width
          waiting.current = true
          setQueue(queueRef.current.slice(1))
        } else {
          el.style.transform = `translateX(${-offset.current}px)`
          if (el.scrollWidth - offset.current < box.clientWidth + 200) {
            // Running short on the right: queue the next insight.
            const slot = next()
            if (slot) { waiting.current = true; setQueue([...queueRef.current, slot]) }
          }
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduceMotion])

  if (latest.length === 0 && queue.length === 0) return null
  // Reduced motion: a static, scrollable list of the current insights.
  const slots = reduceMotion ? latest.map((i, n) => ({ key: n, id: i.id })) : queue

  return (
    <div className="insights" aria-label="Race insights"
      onMouseEnter={() => { paused.current = true }}
      onMouseLeave={() => { paused.current = false; onHighlight([]) }}>
      <span className="insights-label">Insights</span>
      <div className="insights-track" ref={track}>
        <div className="insights-scroll" ref={scroll}>
          {slots.map((s) => {
            const i = known.current.get(s.id)
            if (!i) return null
            return (
              <span key={s.key} className={`insight tone-${i.tone}`} onMouseEnter={() => onHighlight(i.carIds)}>
                <span className="insight-icon" aria-hidden>{ICONS[i.kind]}</span>{i.text}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
