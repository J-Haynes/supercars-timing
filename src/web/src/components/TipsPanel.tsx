import { TIPS } from '../tips'

/** Tips at the bottom of the page. Closing it is remembered; the footer link brings it back. */
export function TipsPanel({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: () => void }) {
  if (!open) {
    return (
      <footer className="page-footer">
        <button type="button" className="link-button" onClick={onOpen}>Show tips</button>
      </footer>
    )
  }
  return (
    <section className="tips" aria-label="Tips">
      <div className="tips-head">
        <h2>Tips</h2>
        <button type="button" onClick={onClose} aria-label="Close tips">×</button>
      </div>
      <ul>
        {TIPS.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </section>
  )
}
