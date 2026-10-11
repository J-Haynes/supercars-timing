import { useLayoutEffect, useRef } from 'react'

/**
 * Animates tower rows when the running order changes, using the FLIP technique: remember where each row was,
 * let React put it in its new place, then start it at the old spot and slide it to the new one. A row that gains
 * places pulses green, one that loses places pulses red (CSS: `.moved-up` / `.moved-down`).
 *
 * @param ids car IDs in display order
 * @returns a ref callback for each row: `ref={rowRef(car.id)}`
 */
export function useRowMoves(ids: string[]) {
  const rows = useRef(new Map<string, HTMLTableRowElement>())
  const lastTop = useRef(new Map<string, number>())
  const lastRank = useRef(new Map<string, number>())
  const lastCount = useRef(0)

  // Runs after every render, before the browser paints, so the jump to the new place is never visible.
  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    // A car joining or leaving shifts everyone's rank: just record the new layout, don't animate the whole field.
    const sameField = ids.length === lastCount.current
    lastCount.current = ids.length

    ids.forEach((id, rank) => {
      const row = rows.current.get(id)
      if (!row) return
      const top = row.offsetTop // ignores transforms, so a row mid-slide still reports its real place
      const oldTop = lastTop.current.get(id)
      const oldRank = lastRank.current.get(id)
      lastTop.current.set(id, top)
      lastRank.current.set(id, rank)
      if (!sameField || oldRank === undefined || oldRank === rank) return

      // Restart the tint pulse (removing the class and forcing a reflow lets the animation play again).
      row.classList.remove('moved-up', 'moved-down')
      void row.offsetWidth
      row.classList.add(rank < oldRank ? 'moved-up' : 'moved-down')

      if (reduceMotion || oldTop === undefined || oldTop === top) return
      row.style.transition = 'none'
      row.style.transform = `translateY(${oldTop - top}px)`
      void row.offsetHeight // commit the starting position before animating away from it
      requestAnimationFrame(() => {
        row.style.transition = 'transform 700ms cubic-bezier(.2, .8, .2, 1)'
        row.style.transform = ''
      })
    })
  })

  return (id: string) => (el: HTMLTableRowElement | null) => {
    if (el) rows.current.set(id, el)
    else rows.current.delete(id)
  }
}
