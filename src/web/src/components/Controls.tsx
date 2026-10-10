import { MAX_DELAY_SECONDS } from '../useDelayedUpdate'
import { ManufacturerKey } from './ManufacturerKey'

type FocusCard = 'auto' | 'on' | 'off'

export function Controls({ simple, delay, buffered, replaying, onSimple, onDelay, focusCard, onFocusCard }: {
  simple: boolean
  delay: number
  buffered: number
  /** Broadcast delay doesn't apply to replays. */
  replaying: boolean
  onSimple: (simple: boolean) => void
  onDelay: (seconds: number) => void
  focusCard: FocusCard
  onFocusCard: (value: FocusCard) => void
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

      <label className="focus-select" title="Card showing the car on its run vs provisional pole. Auto = Shootout sessions only.">
        On-track card
        <select value={focusCard} onChange={(e) => onFocusCard(e.target.value as FocusCard)}>
          <option value="auto">Auto</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>

      {replaying ? (
        <div className="delay muted">Broadcast delay is off while replaying</div>
      ) : (
        <div className="delay" title="Hold the timing back so it matches a delayed TV or stream broadcast">
          <span className="delay-label">Broadcast delay</span>
          <button type="button" onClick={() => setDelay(delay - 5)} aria-label="Decrease delay by 5 seconds">−5</button>
          <button type="button" onClick={() => setDelay(delay - 1)} aria-label="Decrease delay by 1 second">−1</button>
          <input
            type="range" min={0} max={120} step={1}
            value={Math.min(delay, 120)}
            onChange={(e) => setDelay(Number(e.target.value))}
            aria-label="Broadcast delay in seconds"
          />
          <button type="button" onClick={() => setDelay(delay + 1)} aria-label="Increase delay by 1 second">+1</button>
          <button type="button" onClick={() => setDelay(delay + 5)} aria-label="Increase delay by 5 seconds">+5</button>
          <span className="delay-value">{delay === 0 ? 'Live' : `${delay}s behind live`}</span>
          {delay > 0 && <button type="button" className="link" onClick={() => setDelay(0)}>Reset</button>}
          {filling && <span className="delay-filling">buffering {Math.floor(buffered)}/{delay}s</span>}
        </div>
      )}

      <ManufacturerKey />
    </div>
  )
}
