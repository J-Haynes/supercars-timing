import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The map's on/off layers (Corners, Battles, Buildings, Landmarks) in one "Layers" menu instead of a row of buttons:
 * the map toolbar took three rows above a narrow map. A native <details>, so it opens with the keyboard too; it closes
 * on a click or tap outside it, or Escape.
 */
export function MapLayers({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current
      if (!el?.open) return
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [])
  return (
    <details ref={ref} className="map-layers">
      <summary title="Corners, battles, buildings and landmarks">Layers</summary>
      <div className="map-layers-menu">{children}</div>
    </details>
  )
}
