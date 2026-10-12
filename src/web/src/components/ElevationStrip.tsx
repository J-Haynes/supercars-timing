import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CarRow } from '../types'
import type { TrackDefinition } from '../tracks/types'

/** A car on the strip: where the map placed it this frame, in metres along the lap. */
export interface StripCar {
  car: CarRow
  distance: number
  dim: boolean
}

// Labels that would crowd the start/finish end of the strip (same idea as the map's HIDDEN_LABELS).
const HIDDEN_LABELS = /line$|^pit straight$/i
const VIEW_W = 1000
const VIEW_H = 100
/** Room under the lowest point (so cars at the bottom aren't cut off) and over the highest (for the labels), in %. */
const FLOOR = 8
const HEADROOM = 26
/** Width kept clear at the top right for the climb figure, in px. */
const SCALE_WIDTH = 80

/**
 * Side view of one lap: height against distance from the control line, with every car on track at the
 * distance the map gives it. Heights come from the track file (TrackBuilder, smoothed SRTM), so the hills are
 * the right shape but not survey-accurate; the vertical scale is stretched so a 20 m rise is still visible.
 *
 * The profile is an SVG stretched to the strip (preserveAspectRatio="none"); cars and labels are HTML placed by
 * percentage on top of it, so they stay round and readable at any width.
 */
export function ElevationStrip({ track, elevation, cars, caution, hoverId, pinned, onHover }: {
  track: TrackDefinition
  elevation: number[]
  cars: StripCar[]
  caution: boolean
  hoverId: string | null
  pinned: string[]
  onHover: (id: string | null) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useWidth(ref)
  const top = useMemo(() => Math.max(...elevation), [elevation])
  /** Strip coordinates (0-100 %) for a distance along the lap. */
  const x = (d: number) => (d / track.length) * 100
  const y = (d: number) => {
    const f = d / track.step
    const i = Math.floor(f) % elevation.length
    const j = (i + 1) % elevation.length
    const h = elevation[i] + (f - Math.floor(f)) * (elevation[j] - elevation[i])
    return 100 - FLOOR - (h / (top || 1)) * (100 - FLOOR - HEADROOM)
  }

  const profile = useMemo(() => {
    const pts = elevation.map((_, k) => `${((k * track.step) / track.length * VIEW_W).toFixed(1)} ${(y(k * track.step) / 100 * VIEW_H).toFixed(1)}`)
    const line = `M${pts.join('L')}L${VIEW_W} ${(y(0) / 100 * VIEW_H).toFixed(1)}`
    return { line, area: `${line}L${VIEW_W} ${VIEW_H}L0 ${VIEW_H}Z` }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- y only depends on these
  }, [elevation, track.length, track.step, top])

  // Corner names that fit: left to right, skipping any that would overlap the previous one (about 6.5 px a letter).
  const labels = useMemo(() => {
    const shown: { name: string; distance: number }[] = []
    let freeFrom = -Infinity
    for (const l of track.labels.filter((l) => !HIDDEN_LABELS.test(l.name)).sort((a, b) => a.distance - b.distance)) {
      const centre = (l.distance / track.length) * width
      const half = (l.name.length * 6.5) / 2
      if (centre - half < freeFrom || centre - half < 0 || centre + half > width - SCALE_WIDTH) continue
      shown.push(l)
      freeFrom = centre + half + 10
    }
    return shown
  }, [track.labels, track.length, width])

  return (
    <div ref={ref} className={`elev-strip${caution ? ' caution' : ''}`}
      role="img" aria-label={`Elevation profile of ${track.name}, ${Math.round(top)} m from lowest to highest point, with each car's estimated position`}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden>
        <path d={profile.area} className="elev-area" />
        <path d={profile.line} className="elev-line" vectorEffect="non-scaling-stroke" />
        {track.timingPoints.filter((p) => p.id !== 'M').map((p) => (
          <line key={p.id} x1={x(p.distance) * VIEW_W / 100} x2={x(p.distance) * VIEW_W / 100} y1={VIEW_H} y2={y(p.distance) * VIEW_H / 100}
            className="elev-tick" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      {labels.map((l) => (
        <span key={l.name} className="elev-label" style={{ left: `${x(l.distance)}%` }}>{l.name}</span>
      ))}
      <span className="elev-scale">{Math.round(top)} m climb</span>
      {cars.map(({ car, distance, dim }) => {
        const big = car.id === hoverId || pinned.includes(car.carNumber)
        return (
          <span key={car.id}
            className={`elev-car mfr-${car.manufacturer.toLowerCase()}${dim ? ' dim' : ''}${big ? ' big' : ''}`}
            style={{ left: `${x(distance)}%`, top: `${y(distance)}%`, ...(car.teamColour ? { background: `#${car.teamColour}` } : {}) }}
            title={`P${car.position} #${car.carNumber} ${car.driver}`}
            onMouseEnter={() => onHover(car.id)} onMouseLeave={() => onHover(null)}>
            {big && <b>{car.carNumber}</b>}
          </span>
        )
      })}
    </div>
  )
}

/** Width of an element in CSS pixels, kept up to date as it resizes. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
