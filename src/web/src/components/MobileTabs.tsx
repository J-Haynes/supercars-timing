export type MobileTab = 'tower' | 'map' | 'race' | 'charts'

const KEY = 'supercars-timing:mobile-tab'

export function loadMobileTab(): MobileTab {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'map' || v === 'race' || v === 'charts' ? v : 'tower'
  } catch {
    return 'tower'
  }
}

export function saveMobileTab(tab: MobileTab) {
  try { localStorage.setItem(KEY, tab) } catch { /* storage blocked: fine */ }
}

/**
 * Tab bar for phones (CSS shows it under 760 px only). Picks which part of the page is visible: the leaderboard (tower), the map,
 * race panels (ladders, race control, pit stops) or charts. Everything stays mounted, so switching keeps the map's
 * zoom and the chart selections.
 */
export function MobileTabs({ tab, race, onTab }: { tab: MobileTab; race: boolean; onTab: (tab: MobileTab) => void }) {
  const tabs: [MobileTab, string][] = [['tower', 'Leaderboard'], ['map', 'Map'], ['race', race ? 'Race' : 'Info'], ...(race ? [['charts', 'Charts'] as [MobileTab, string]] : [])]
  return (
    <nav className="mobile-tabs" aria-label="Sections">
      {tabs.map(([k, name]) => (
        <button key={k} type="button" className={tab === k ? 'active' : ''} aria-pressed={tab === k} onClick={() => onTab(k)}>{name}</button>
      ))}
    </nav>
  )
}
