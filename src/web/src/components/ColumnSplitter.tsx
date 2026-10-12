import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

const MIN_MAP = 380 // px, the map column's narrowest (as in the CSS default)
const MIN_TOWER = 520 // px left for the tower
const STEP = 40 // px per arrow key press
// Remembers that the viewer has used (or dismissed) the divider, so the "Drag to resize" hint shows only until then.
const HINT_KEY = 'supercars-timing:splitter-hint-seen'
const hintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1' } catch { return true } }
const markHintSeen = () => { try { localStorage.setItem(HINT_KEY, '1') } catch { /* private mode: just hide it */ } }

/**
 * The handle between the tower and the map on wide screens: drag it to make the map column wider or narrower.
 * Made to look movable: a line that's always there, a grip with dots and ◂ ▸ arrows that stays in view while the page
 * scrolls, a resize cursor and highlight on hover, and a one-time "Drag to resize" hint.
 * The width is a CSS variable on the layout (`--map-width`, see styles.css), saved in settings when the drag ends.
 * Double-click (or Home) goes back to the automatic width. Hidden on narrower screens, where the columns stack.
 */
export function ColumnSplitter({ width, onWidth }: { width: number | null; onWidth: (px: number | null) => void }) {
  const [dragging, setDragging] = useState(false)
  const [hint, setHint] = useState(() => !hintSeen())
  const dismissHint = () => { if (hint) { setHint(false); markHintSeen() } }
  const latest = useRef(width)

  /** Map width for a pointer at clientX: from the pointer to the layout's right edge, within limits. */
  const widthAt = (handle: HTMLElement, clientX: number) => {
    const layout = handle.parentElement!.getBoundingClientRect()
    const raw = layout.right - clientX - handle.offsetWidth / 2
    return Math.round(Math.min(Math.max(raw, MIN_MAP), layout.width - MIN_TOWER))
  }
  const current = (handle: HTMLElement) => width ?? handle.nextElementSibling?.getBoundingClientRect().width ?? MIN_MAP

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
    dismissHint()
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    // Set the variable directly while dragging (no re-render of the whole page per pixel); saved on release.
    latest.current = widthAt(e.currentTarget, e.clientX)
    e.currentTarget.parentElement!.style.setProperty('--map-width', `${latest.current}px`)
  }
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
    onWidth(latest.current)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const handle = e.currentTarget
    const layout = handle.parentElement!.getBoundingClientRect()
    const clamp = (px: number) => Math.min(Math.max(px, MIN_MAP), layout.width - MIN_TOWER)
    if (e.key === 'ArrowLeft') onWidth(clamp(current(handle) + STEP))
    else if (e.key === 'ArrowRight') onWidth(clamp(current(handle) - STEP))
    else if (e.key === 'Home') onWidth(null)
    else return
    e.preventDefault()
  }

  return (
    <div className={`col-splitter${dragging ? ' dragging' : ''}`} role="separator" aria-orientation="vertical"
      aria-label="Map width: drag, or use the arrow keys. Double-click to reset." tabIndex={0}
      title="Drag to resize the map · double-click to reset"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(null)} onKeyDown={(e) => { dismissHint(); onKeyDown(e) }}>
      <div className="col-grip" aria-hidden>
        <span className="col-grip-arrow">◂</span>
        <span className="col-grip-dots" />
        <span className="col-grip-arrow">▸</span>
        {hint && (
          <span className="col-hint" role="note">
            Drag to resize the map
            <button type="button" aria-label="Dismiss" onPointerDown={(e) => e.stopPropagation()} onClick={dismissHint}>×</button>
          </span>
        )}
      </div>
    </div>
  )
}
