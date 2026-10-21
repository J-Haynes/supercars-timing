import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/** Smallest and largest map height (px), and the arrow-key step. */
const MIN_HEIGHT = 240
const MARGIN = 80 // keep this much of the window free below the map at the largest
const STEP = 40

/**
 * The grip under the map: drag it up or down to change the map's height (2D and 3D, every page with a map). Double-click
 * or Home resets it; the arrow keys move it while focused. Like the tower/map divider (ColumnSplitter), it sets the CSS
 * variable directly while dragging and saves the height (settings.mapHeight) on release.
 */
export function MapHeightHandle({ height, onHeight }: { height: number | null; onHeight: (height: number | null) => void }) {
  const [dragging, setDragging] = useState(false)
  const latest = useRef(height)

  /** The map surface (2D svg or 3D canvas) this handle sizes: the .map-stage in the same MapView. */
  const stage = (handle: HTMLElement) => handle.parentElement?.querySelector('.map-stage')?.getBoundingClientRect()
  const clamp = (px: number) => Math.round(Math.min(Math.max(px, MIN_HEIGHT), window.innerHeight - MARGIN))

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const top = dragging ? stage(e.currentTarget)?.top : undefined
    if (top === undefined) return
    // The handle sits under the caption: follow the pointer, keeping that gap.
    const gap = e.currentTarget.getBoundingClientRect().top - (stage(e.currentTarget)?.bottom ?? 0)
    latest.current = clamp(e.clientY - top - gap)
    const view = e.currentTarget.parentElement!
    view.classList.add('sized')
    view.style.setProperty('--map-height', `${latest.current}px`)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    onHeight(latest.current)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const now = height ?? stage(e.currentTarget)?.height ?? MIN_HEIGHT
    if (e.key === 'ArrowDown') onHeight(clamp(now + STEP))
    else if (e.key === 'ArrowUp') onHeight(clamp(now - STEP))
    else if (e.key === 'Home') onHeight(null)
    else return
    e.preventDefault()
  }

  return (
    <div className={`map-height-handle${dragging ? ' dragging' : ''}`} role="separator" aria-orientation="horizontal" tabIndex={0}
      aria-label="Map height: drag, or use the up and down arrow keys. Double-click to reset."
      title="Drag to change the map's height · double-click to reset"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={() => onHeight(null)} onKeyDown={onKeyDown}>
      <span className="map-height-grip" aria-hidden />
    </div>
  )
}
