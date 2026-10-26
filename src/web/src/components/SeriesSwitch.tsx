import type { MouseEvent } from 'react'
import { SERIES, SERIES_HOME, SERIES_LABEL, type Series } from '../series'
// Logos: F1 from Wikimedia Commons (File:F1.svg); the Supercars "S" mark cropped from the championship logo on
// Wikipedia (File:Supercars_Championship_Logo_2021.png). Trademarks of their owners; used here for a personal app.
import f1Logo from '../assets/f1-logo.svg'
import supercarsMark from '../assets/supercars-mark.png'

const SERIES_LOGO: Record<Series, string> = { v8: supercarsMark, f1: f1Logo }

/** The query that opens the menu as the page loads (`opensMenu`): switching series from the menu lands in the menu. */
const MENU_PARAM = 'menu'

/**
 * Master switch between the Supercars app (/) and the F1 app (/f1): in the header (logos) and at the top of the menu
 * (logos and names). Remembered for the next visit to /. Switching is a full page load (each app is fixed to its
 * series, series.ts); the series already open does nothing, like a segmented control's selected option (owner, Oct
 * 2026: it used to reload the page, and drop a results page or replay).
 */
export function SeriesSwitch({ inMenu = false }: { inMenu?: boolean }) {
  const choose = (s: Series, e: MouseEvent) => {
    if (s === SERIES) { e.preventDefault(); return }
    try { localStorage.setItem('supercars-timing:series', s) } catch { /* private mode: not remembered */ }
  }
  return (
    <nav className={`series-switch${inMenu ? ' in-menu' : ''}`} aria-label="Series">
      {(['v8', 'f1'] as const).map((s) => (
        <a key={s} href={inMenu ? `${SERIES_HOME[s]}?${MENU_PARAM}` : SERIES_HOME[s]} className={s === SERIES ? 'active' : ''}
          onClick={(e) => choose(s, e)} title={SERIES_LABEL[s]} aria-current={s === SERIES ? 'page' : undefined}>
          <img src={SERIES_LOGO[s]} alt={inMenu ? '' : SERIES_LABEL[s]} className={`series-logo series-logo-${s}`} />
          {inMenu && <span>{SERIES_LABEL[s]}</span>}
        </a>
      ))}
    </nav>
  )
}

/** True once, as the page loads, if it was opened from the menu's switch; the query is taken off the address. */
export function opensMenu(): boolean {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(MENU_PARAM)) return false
  url.searchParams.delete(MENU_PARAM)
  window.history.replaceState(window.history.state, '', url)
  return true
}
