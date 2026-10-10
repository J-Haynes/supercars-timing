import { useRef, useState } from 'react'
import type { ReplayStatus } from '../types'

const SPEEDS = [1, 2, 5, 10, 30, 60]

/** Play/pause, scrubber, speed and "back to live" while watching a recorded session. */
export function ReplayBar({ replay, onPlay, onSeek, onSpeed, onLive }: {
  replay: ReplayStatus
  onPlay: (playing: boolean) => void
  onSeek: (seconds: number) => void
  onSpeed: (speed: number) => void
  onLive: () => void
}) {
  // While dragging, show the dragged position and send seeks at most every 150 ms.
  const [dragging, setDragging] = useState<number | null>(null)
  const lastSeek = useRef(0)

  const position = dragging ?? replay.position
  const seek = (s: number, force = false) => {
    setDragging(s)
    const now = performance.now()
    if (force || now - lastSeek.current > 150) { onSeek(s); lastSeek.current = now }
  }

  return (
    <div className="replay-bar">
      <span className="replay-label">Replay</span>
      <span className="replay-name">{replay.name.replace(/^\d{4}\s+/, '')}</span>
      <button type="button" className="replay-play" onClick={() => onPlay(!replay.playing)} aria-label={replay.playing ? 'Pause' : 'Play'}>
        {replay.playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range" min={0} max={Math.max(1, Math.floor(replay.duration))} step={1} value={Math.floor(position)}
        onChange={(e) => seek(Number(e.target.value))}
        onPointerUp={(e) => { seek(Number((e.target as HTMLInputElement).value), true); setDragging(null) }}
        onKeyUp={(e) => { seek(Number((e.target as HTMLInputElement).value), true); setDragging(null) }}
        aria-label="Replay position"
      />
      <span className="replay-time">{clock(position)} / {clock(replay.duration)}</span>
      <select value={replay.speed} onChange={(e) => onSpeed(Number(e.target.value))} aria-label="Replay speed">
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
      <button type="button" className="replay-live" onClick={onLive}>Back to live</button>
    </div>
  )
}

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
