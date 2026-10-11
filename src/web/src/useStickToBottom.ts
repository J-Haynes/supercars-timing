import { useCallback, useRef } from 'react'

/**
 * For a column that should scroll with the page until its bottom reaches the bottom of the screen, then stay put
 * while the rest of the page keeps scrolling. CSS sticky does that with a negative `top` of
 * (screen height − column height), which needs the column's height: this keeps `--stick-height` up to date on
 * the element. The CSS (styles.css, `.tower-column`) uses it on wide screens only.
 *
 * Returns a callback ref, so it starts measuring whenever the column appears (it only renders once there's data).
 */
export function useStickToBottom<T extends HTMLElement>() {
  const observer = useRef<ResizeObserver | null>(null)
  return useCallback((el: T | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => el.style.setProperty('--stick-height', `${el.offsetHeight}px`)
    observer.current = new ResizeObserver(update)
    observer.current.observe(el)
    update()
  }, [])
}
