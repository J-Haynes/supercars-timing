import { MAX_DELAY_SECONDS } from '../useDelayedUpdate'
import { ManufacturerKey } from './ManufacturerKey'

/**
 * Simple mode: switched often over a race weekend, so it's always on the toolbar (live) and in the replay bar, never
 * behind a menu.
 */
export function SimpleSwitch({ simple, onSimple }: { simple: boolean; onSimple: (simple: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={simple} onChange={(e) => onSimple(e.target.checked)} />
      <span className="track" aria-hidden><span className="thumb" /></span>
      Simple mode
    </label>
  )
}

/**
 * The live page's toolbar: what's changed while watching (Simple mode, the broadcast delay) and the way into Settings.
 * Set-once options (the on-track card, tower columns) are in the Settings drawer, also reachable in replays.
 */
export function Controls({ simple, onSimple, delay, buffered, onDelay, onSettings }: {
  simple: boolean
  onSimple: (simple: boolean) => void
  delay: number
  buffered: number
  onDelay: (seconds: number) => void
  onSettings: () => void
}) {
  const setDelay = (s: number) => onDelay(Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.round(s))))
  const filling = delay > 0 && buffered < delay - 0.5

  return (
    <div className="controls">
      <SimpleSwitch simple={simple} onSimple={onSimple} />

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

      <button type="button" className="settings-button" onClick={onSettings}>⚙ Settings</button>

      <ManufacturerKey />
    </div>
  )
}
