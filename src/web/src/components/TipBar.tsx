export function TipBar({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="tip-bar" role="note">
      <span><strong>Tip:</strong> double-click a driver in the timing tower or on the map to highlight them. Double-click again to remove the highlight.</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss tip">×</button>
    </div>
  )
}
