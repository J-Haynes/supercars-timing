import { useMemo, useRef } from 'react'
import type { TimingSnapshot } from '../types'
import { buildInsights, newMemory, type Insight } from '../insights'

const ICONS: Record<Insight['kind'], string> = {
  fastest: '⏱', lead: '🏁', penalty: '⚠', control: '📣', battle: '⚔', closing: '↗', minLaps: '⛽', mover: '⇅', longRun: '🔧',
}

/**
 * Scrolling strip of race insights above the tower (insights.ts). It pauses while hovered; hovering an item
 * highlights its cars in the tower and on the map.
 */
export function InsightsTicker({ timing, onHighlight }: { timing: TimingSnapshot; onHighlight: (ids: string[]) => void }) {
  const memory = useRef(newMemory())
  const sessionKey = useRef('')
  const key = `${timing.session.meeting}|${timing.session.name}`
  if (sessionKey.current !== key) { memory.current = newMemory(); sessionKey.current = key }
  const insights = useMemo(() => buildInsights(timing, memory.current), [timing])
  if (insights.length === 0) return null

  // Scroll speed in proportion to the amount of text, so it reads at the same pace however many items there are.
  const seconds = Math.max(25, Math.round(insights.reduce((n, i) => n + i.text.length, 0) / 9))
  const items = (copy: number) => insights.map((i) => (
    <span
      key={`${copy}-${i.id}`}
      className={`insight tone-${i.tone}`}
      onMouseEnter={() => onHighlight(i.carIds)}
      aria-hidden={copy > 0 || undefined}
    >
      <span className="insight-icon" aria-hidden>{ICONS[i.kind]}</span>{i.text}
    </span>
  ))

  return (
    <div className="insights" onMouseLeave={() => onHighlight([])} aria-label="Race insights">
      <span className="insights-label">Insights</span>
      <div className="insights-track">
        {/* Two copies side by side so the loop is seamless. */}
        <div className="insights-scroll" style={{ animationDuration: `${seconds}s` }}>
          {items(0)}{items(1)}
        </div>
      </div>
    </div>
  )
}
