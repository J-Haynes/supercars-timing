/** A chequered flag: a car that has finished (timing tower), and races in the menu's results list. */
export function ChequerIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M2.5 1.5v13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.5" y="2" width="11" height="7.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M3.5 2h3.67v2.5H3.5zM10.83 2h3.67v2.5h-3.67zM7.17 4.5h3.66V7H7.17zM3.5 7h3.67v2.5H3.5zM10.83 7h3.67v2.5h-3.67z" fill="currentColor" />
    </svg>
  )
}
