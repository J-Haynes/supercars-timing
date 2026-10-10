const MAKES = [
  { key: 'ford', label: 'Ford' },
  { key: 'chevrolet', label: 'Chevrolet' },
  { key: 'toyota', label: 'Toyota' },
]

/** Colour key for the car badges in the tower and dots on the map. */
export function ManufacturerKey() {
  return (
    <div className="mfr-key" aria-label="Manufacturer colours">
      {MAKES.map((m) => (
        <span key={m.key} className="mfr-key-item">
          <span className={`mfr-swatch mfr-${m.key}`} />
          {m.label}
        </span>
      ))}
    </div>
  )
}
