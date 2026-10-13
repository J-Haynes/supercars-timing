import { useCallback, useRef, useState } from 'react'
import { SLOTS } from './chartData'

/** Cars at once in the small charts panel (the large view takes up to eight). */
export const MAX_CHART_CARS = 5

/** Which cars the race charts show, and the colour each one keeps while it's on. */
export interface ChartSelection {
  selected: string[]
  /** Add the car, or take it off. Adding a sixth drops the oldest. */
  toggle: (id: string) => void
  colorOf: (id: string) => string
}

/**
 * The race charts' car selection. Lives in App so the tower's chart buttons and the charts panel share it; results
 * pages keep their own. Starts with `initial` (the top four on the road) until the viewer picks; colour follows the
 * car, not its rank.
 */
export function useChartSelection(initial: string[]): ChartSelection {
  const slots = useRef(new Map<string, number>())
  const [picked, setPicked] = useState<string[] | null>(null)
  const selected = picked ?? initial
  const colorOf = (id: string) => {
    if (!slots.current.has(id)) {
      const used = new Set([...slots.current.entries()].filter(([k]) => selected.includes(k)).map(([, v]) => v))
      slots.current.set(id, [...SLOTS.keys()].find((i) => !used.has(i)) ?? 0)
    }
    return SLOTS[slots.current.get(id)!]
  }
  const selectedKey = selected.join(',')
  const toggle = useCallback((id: string) => {
    const current = selectedKey ? selectedKey.split(',') : []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-MAX_CHART_CARS)
    for (const k of [...slots.current.keys()]) if (!next.includes(k)) slots.current.delete(k)
    setPicked(next)
  }, [selectedKey])
  return { selected, toggle, colorOf }
}
