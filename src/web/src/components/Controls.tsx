import { MAX_DELAY_SECONDS } from '../useDelayedUpdate'

export function Controls({ simple, delay, buffered, onSimple, onDelay }: {
  simple: boolean
  delay: number
  buffered: number
  onSimple: (simple: boolean) => void
  onDelay: (seconds: number) => void
}) {
  const setDelay = (s: number) => onDelay(Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.round(s))))
  const filling = delay > 0 && buffered < delay - 0.5

  return (
    <div className="controls">
      <label className="switch">
        <input type="checkbox" checked={simple} onChange={(e) => onSimple(e.target.checked)} />
        <span className="track" aria-hidden><span className="thumb" /></span>
        Simple mode
      </label>

      <div className="delay" title="Hold the timing back so it matches a delayed TV or stream broadcast">
        <span className="delay-label">Broadcast delay</span>
        <button type="button" onClick={() => setDelay(delay - 1)} aria-label="Decrease delay by 1 second">−</button>
        <input
          type="range" min={0} max={120} step={1}
          value={Math.min(delay, 120)}
          onChange={(e) => setDelay(Number(e.target.value))}
          aria-label="Broadcast delay in seconds"
        />
        <button type="button" onClick={() => setDelay(delay + 1)} aria-label="Increase delay by 1 second">+</button>
        <span className="delay-value">{delay}s</span>
        {delay > 0 && <button type="button" className="link" onClick={() => setDelay(0)}>Live</button>}
        {filling && <span className="delay-filling">buffering {Math.floor(buffered)}/{delay}s</span>}
      </div>
    </div>
  )
}
