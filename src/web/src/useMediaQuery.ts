import { useEffect, useState } from 'react'

/** Phones: the width where the page switches to tabs (MobileTabs, styles.css). */
export const PHONE = '(max-width: 760px)'

/** Whether a CSS media query matches, following changes (window resizes, phone rotation). */
export function useMediaQuery(query: string): boolean {
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
