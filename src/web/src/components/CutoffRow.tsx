import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/**
 * The qualifying cut-off line in the tower: a row between two cars that the viewer can drag to another place (mouse
 * or touch), or move with the arrow keys once it has focus. While dragging, `onPreview` moves the line (and the
 * dimming below it) live; letting go commits it with `onSet`, Escape puts it back.
 *
 * Where it lands is counted from the car rows (`tr[data-car]`) whose middle is above the pointer. The line itself is
 * one of the rows, so it moves the rows below it; counting that way still settles (once a row is above the line it
 * moves up, away from the pointer), so the line never flickers between two places.
 */
export function CutoffRow({ position, max, colSpan, label, why, manual, canReset, body, onPreview, onSet, onReset }: {
  position: number
  /** The lowest place it can go (under the last car but one). */
  max: number
  colSpan: number
  label: string
  /** Where the line comes from (tooltip). */
  why: string
  /** The viewer's own line rather than the automatic one. */
  manual: boolean
  /** There's an automatic line to go back to. */
  canReset: boolean
  /** The tower's tbody, to find the car rows. */
  body: RefObject<HTMLTableSectionElement | null>
  onPreview: (position: number | null) => void
  onSet: (position: number) => void
  onReset: () => void
}) {
  const [dragging, setDragging] = useState(false)
  // Moving the line moves its row in the DOM, which can take the focus away: give it back after a key press.
  const grip = useRef<HTMLSpanElement>(null)
  const refocus = useRef(false)
  useLayoutEffect(() => {
    if (refocus.current) grip.current?.focus()
    refocus.current = false
  }, [position])
  const clamp = (n: number) => Math.max(1, Math.min(max, n))

  const startDrag = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !body.current) return
    e.preventDefault() // no text selection, no scrolling on touch (with touch-action: none in CSS)
    const rows = () => [...body.current!.querySelectorAll<HTMLElement>('tr[data-car]')]
    const at = (y: number) => clamp(rows().filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < y }).length)
    let last = position
    // On the window, not pointer capture: React moves this row in the DOM as it's dragged, which can drop a capture.
    const move = (ev: PointerEvent) => {
      const next = at(ev.clientY)
      if (next !== last) { last = next; onPreview(next) }
    }
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', escape)
      setDragging(false)
      onPreview(null)
      if (commit && last !== position) onSet(last)
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    const escape = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') finish(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', escape)
    setDragging(true)
  }

  const keys = (e: KeyboardEvent) => {
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 }
    if (e.key in step) {
      e.preventDefault()
      const next = clamp(position + step[e.key])
      if (next !== position) { refocus.current = true; onSet(next) }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onSet(0)
    }
  }

  return (
    <tr className={['cutoff-row', dragging && 'dragging', manual && 'manual'].filter(Boolean).join(' ')} onPointerDown={startDrag}>
      <td colSpan={colSpan}>
        <span
          ref={grip}
          className="cutoff-grip"
          role="slider"
          tabIndex={0}
          aria-label="Qualifying cut-off line"
          aria-valuemin={1}
          aria-valuemax={max}
          aria-valuenow={position}
          aria-valuetext={`Top ${position}`}
          onKeyDown={keys}
          title={`${why}. Drag the line (or use the arrow keys) to move it.`}
        >
          <span className="cutoff-handle" aria-hidden>⠿</span>
          <span className="cutoff-label">{label}</span>
        </span>
        <span className="cutoff-tools">
          {canReset && <button type="button" onClick={onReset} title="Back to the automatic cut-off">Auto</button>}
          <button type="button" onClick={() => onSet(0)} aria-label="Remove the cut-off line" title="Remove the line for this session">×</button>
        </span>
      </td>
    </tr>
  )
}
