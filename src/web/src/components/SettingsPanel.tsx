import { useState } from 'react'
import { isF1 } from '../series'
import { COLUMN_LABELS, LOCKED_COLUMNS, columnPrefs, type ColumnPrefs, type SessionKind } from '../towerLayout'

const KIND_LABELS: Record<SessionKind, string> = { timed: 'Practice & qualifying', race: 'Race' }

export type FocusCard = 'auto' | 'on' | 'off'

/**
 * Settings drawer (live and replay): the on-track card, and which tower columns show in detailed mode,
 * in what order, separately for practice/qualifying and races. Drag a row or use the arrows to move it; untick to hide it.
 */
export function SettingsPanel({ open, onClose, kind: initialKind, columns, onColumns, focusCard, onFocusCard, qualifyingCut, onQualifyingCut, finalistBadges, onFinalistBadges }: {
  open: boolean
  onClose: () => void
  /** Session kind on screen, so the panel opens on the layout the viewer is looking at. */
  kind: SessionKind
  columns: Partial<Record<SessionKind, ColumnPrefs>>
  onColumns: (columns: Partial<Record<SessionKind, ColumnPrefs>>) => void
  focusCard: FocusCard
  onFocusCard: (value: FocusCard) => void
  /** Qualifying cut-off line under this position; 0 = none. */
  qualifyingCut: number
  onQualifyingCut: (position: number) => void
  /** Gold badge on finalists' car numbers (Supercars only). */
  finalistBadges: boolean
  onFinalistBadges: (on: boolean) => void
}) {
  const [kind, setKind] = useState<SessionKind>(initialKind)
  const [dragging, setDragging] = useState<number | null>(null)
  const prefs = columnPrefs(kind, columns[kind])

  const save = (next: ColumnPrefs) => onColumns({ ...columns, [kind]: next })
  const move = (from: number, to: number) => {
    if (to < 0 || to >= prefs.order.length || from === to) return
    const order = [...prefs.order]
    order.splice(to, 0, ...order.splice(from, 1))
    save({ ...prefs, order })
  }
  const toggle = (key: string) =>
    save({ ...prefs, hidden: prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key] })
  const reset = () => {
    const next = { ...columns }
    delete next[kind]
    onColumns(next)
  }

  return (
    <>
      <div className={`menu-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`settings-panel${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Settings">
        <div className="menu-head">
          <span>Settings</span>
          <button type="button" onClick={onClose} aria-label="Close settings">×</button>
        </div>

        <h2>Timing tower</h2>
        <label className="focus-select" title="Card showing the car on its run vs provisional pole. Auto = Shootout sessions only.">
          On-track card
          <select value={focusCard} onChange={(e) => onFocusCard(e.target.value as FocusCard)}>
            <option value="auto">Auto (Top Ten Shootout)</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>

        <label className="focus-select" title="A line in the tower under this position during qualifying sessions. The cut differs by event, so you set it.">
          Qualifying cut-off line
          <select value={qualifyingCut} onChange={(e) => onQualifyingCut(Number(e.target.value))}>
            <option value={0}>Off</option>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Top {n}</option>)}
          </select>
        </label>

        {!isF1 && (
          <label className="settings-check" title="At Finals rounds: a gold badge on the car numbers of the drivers still in the Finals">
            <input type="checkbox" checked={finalistBadges} onChange={(e) => onFinalistBadges(e.target.checked)} />
            Gold badge for drivers in the Finals
          </label>
        )}

        <h2>Tower columns (detailed mode)</h2>
        <div className="segmented" role="tablist">
          {(Object.keys(KIND_LABELS) as SessionKind[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={k === kind} className={k === kind ? 'active' : ''} onClick={() => setKind(k)}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <p className="menu-muted">Drag to reorder, or use the arrows. Simple mode always uses its own short list.</p>

        <ol className="column-list">
          {prefs.order.map((key, i) => {
            const locked = LOCKED_COLUMNS.includes(key)
            const shown = !prefs.hidden.includes(key)
            return (
              <li
                key={key}
                draggable
                onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragging !== null) move(dragging, i); setDragging(null) }}
                onDragEnd={() => setDragging(null)}
                className={[shown ? '' : 'hidden-column', dragging === i ? 'dragging' : ''].join(' ')}
              >
                <span className="grip" aria-hidden>⋮⋮</span>
                <label>
                  <input type="checkbox" checked={shown} disabled={locked} onChange={() => toggle(key)} />
                  {COLUMN_LABELS[key] ?? key}
                  {locked && <span className="menu-muted"> (always shown)</span>}
                </label>
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${COLUMN_LABELS[key]} up`}>↑</button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === prefs.order.length - 1} aria-label={`Move ${COLUMN_LABELS[key]} down`}>↓</button>
              </li>
            )
          })}
        </ol>
        <button type="button" className="link-button" onClick={reset}>Reset {KIND_LABELS[kind].toLowerCase()} columns to default</button>
      </aside>
    </>
  )
}
