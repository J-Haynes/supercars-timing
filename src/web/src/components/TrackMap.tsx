import { teamStyle } from '../series'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { CarRow, TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import type { MapFeed } from '../map/crossingLog'
import { TrackModel, type Vec } from '../map/trackModel'
import { useCarPlacement } from '../map/useCarPlacement'
import { notableBattles, battleSpans } from '../battles'
import { ElevationStrip, type StripCar } from './ElevationStrip'
import { ghostOnTrack, type PitGhost } from '../pit/usePitGhost'

const CAR_RADIUS = 46 // metres, in map units
const MAX_ZOOM = 8
// Labels that would sit on top of the start/finish area and its cars.
const HIDDEN_LABELS = /line$|^pit straight$/i

/**
 * Maps track metres (x east, y north) to screen units: flip y so north is up, then rotate about the
 * track's centre. Everything is drawn in screen units, so text stays upright at any rotation.
 */
function makeView(model: TrackModel, rotationDeg: number) {
  const b = model.bounds() // already y-flipped
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  const r = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const toScreen = (p: Vec): Vec => {
    const x = p.x - cx
    const y = -p.y - cy
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }
  }
  /** Rotates a direction vector given in track coordinates. */
  const dirToScreen = (v: Vec): Vec => ({ x: v.x * cos + v.y * sin, y: v.x * sin - v.y * cos })

  const pts = [...model.def.path, ...model.def.pitLane].map(([x, y]) => toScreen({ x, y }))
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const padX = 480 // room for corner labels
  const padY = 160
  const fit = {
    x: Math.min(...xs) - padX,
    y: Math.min(...ys) - padY,
    w: Math.max(...xs) - Math.min(...xs) + padX * 2,
    h: Math.max(...ys) - Math.min(...ys) + padY * 2,
  }
  const line = (coords: [number, number][], close: boolean) =>
    coords.map(([x, y], i) => {
      const p = toScreen({ x, y })
      return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`
    }).join('') + (close ? 'Z' : '')

  return {
    toScreen,
    dirToScreen,
    fit,
    centre: { x: cx, y: cy },
    path: line(model.def.path, true),
    pit: line(model.def.pitLane, false),
  }
}

export function TrackMap({ track, update, live, hoverId, highlightIds = [], focusId, pinned, rotation, onRotate, onHover, onTogglePin, note, extraTools, showLabels = true, showBattles = false, pitGhost = null }: {
  track: TrackDefinition
  update: TimingUpdate
  /** The live (undelayed) update. With a broadcast delay it's ahead of `update`: cars are placed between the
   * crossings either side of the time shown instead of estimated (map/crossingLog.ts). */
  live?: MapFeed | null
  hoverId: string | null
  /** Cars named by the insight under the mouse. */
  highlightIds?: string[]
  /** Car to emphasise automatically (e.g. the car on its Shootout lap). */
  focusId?: string | null
  pinned: string[]
  rotation: number
  onRotate: (degrees: number) => void
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
  /** Replaces the "learning timing points" overlay, e.g. on an upcoming event's page. */
  note?: string
  /** Shown first in the toolbar (MapView's 2D/3D switch). */
  extraTools?: ReactNode
  /** Corner names (the Corners button). */
  showLabels?: boolean
  /** Highlight battles (races, the Battles button). */
  showBattles?: boolean
  /** "If it pitted now" for the chosen car (pit/usePitGhost.ts): drawn behind it on the track. */
  pitGhost?: PitGhost | null
}) {
  const { model, effective, placements, sync, awaitingCalibration, flagNow } = useCarPlacement(track, update, live)
  const battleList = useMemo(() => (showBattles ? notableBattles(update.timing) : []), [showBattles, update.timing])
  const spans = battleSpans(battleList, new Map(placements.flatMap((p) => (p.kind === 'track' ? [[p.car.id, p.distance] as const] : []))), model.length)
  const geometry = useMemo(() => new TrackModel(track), [track])          // outline only: stable for the view
  const view = useMemo(() => makeView(geometry, rotation), [geometry, rotation])
  const { zoom, pan, svgRef, handlers, zoomBy, reset } = useZoomPan(view.fit)

  // Draw order: later = on top. Leader above the field, then pinned, focused, and the hovered car on top.
  const layer = (c: CarRow) => (c.id === hoverId || highlightIds.includes(c.id) ? 3 : c.id === focusId ? 2 : pinned.includes(c.carNumber) ? 1 : 0)
  const drawn = [...placements].sort((a, b) => layer(a.car) - layer(b.car) || (b.car.position || 99) - (a.car.position || 99))
  // Cars on track this frame, for the elevation strip (the same places as the map).
  const stripCars: StripCar[] = placements.flatMap((pl) => (pl.kind === 'track' ? [{ car: pl.car, distance: pl.distance, dim: pl.dim }] : []))

  const w = view.fit.w / zoom
  const h = view.fit.h / zoom
  const viewBox = `${view.fit.x + view.fit.w / 2 - w / 2 + pan.x} ${view.fit.y + view.fit.h / 2 - h / 2 + pan.y} ${w} ${h}`
  const s = (d: number) => view.toScreen(model.pointAt(d))
  const ghost = ghostOnTrack(pitGhost, placements, model)

  return (
    <div className={`track-map${!awaitingCalibration && !sync.synced ? ' syncing' : ''}`}>
      <div className="map-tools" role="toolbar" aria-label="Map view">
        {extraTools}
        <button type="button" onClick={() => onRotate(rotation - 15)} title="Rotate left">⟲</button>
        <button type="button" onClick={() => onRotate(rotation + 15)} title="Rotate right">⟳</button>
        <button type="button" onClick={() => zoomBy(1.4)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} title="Zoom out">−</button>
        <button type="button" onClick={() => { reset(); onRotate(0) }} title="Reset view" className="wide">Reset</button>
      </div>
      {/* The map surface and what sits over it: overlays are placed on the map itself, never over the toolbar or caption. */}
      <div className="map-stage">
      <svg ref={svgRef} viewBox={viewBox} role="img" aria-label={`${track.name} track map`} {...handlers}
        className={zoom > 1 ? 'zoomed' : ''}>
        <path d={view.path} className="track-outline" />
        <path d={view.path} className="track-surface" />
        {track.pitLane.length > 1 && <path d={view.pit} className="pit-lane" />}
        <ControlLine view={view} model={model} />
        {effective.timingPoints.filter((p) => p.id !== 'M').map((p) => {
          const pt = s(p.distance)
          return <circle key={p.id} cx={pt.x} cy={pt.y} r={9} className="timing-point"><title>{p.name}</title></circle>
        })}
        <g style={{ fontSize: 44 / Math.sqrt(zoom) }}>
          {showLabels && track.labels.filter((l) => !HIDDEN_LABELS.test(l.name)).map((l) => (
            <Label key={l.name} view={view} model={model} name={l.name} distance={l.distance} />
          ))}
        </g>
        {/* Battles: a band along the track from the last car to the first, and a label at the front. */}
        {spans.map((sp) => {
          const pts: string[] = []
          for (let d = sp.from; d <= sp.to; d += 5) { const p = s(d); pts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`) }
          const at = s(sp.front)
          return (
            <g key={sp.label} className="map-battle">
              <path d={`M${pts.join('L')}`} />
              <text x={at.x} y={at.y - 70} style={{ fontSize: 40 / Math.sqrt(zoom) }}>{sp.label}</text>
            </g>
          )
        })}
        {/* Pit rejoin ghost: the likely range as a band, the median as a hollow ring with the car number. */}
        {ghost && (() => {
          const pts: string[] = []
          for (let d = ghost.from; d <= ghost.to; d += 5) { const p = s(d); pts.push(`${p.x.toFixed(1)} ${p.y.toFixed(1)}`) }
          const at = s(ghost.mid)
          const k = 1 / Math.sqrt(zoom)
          return (
            <g className="map-ghost">
              <path d={`M${pts.join('L')}`} />
              <g transform={`translate(${at.x.toFixed(1)} ${at.y.toFixed(1)}) scale(${k.toFixed(3)})`}>
                <circle r={CAR_RADIUS} />
                <text dy="0.36em">{ghost.car.carNumber}</text>
                <text className="map-ghost-label" y={-CAR_RADIUS - 24}>{ghost.label}</text>
              </g>
            </g>
          )
        })()}
        {drawn.map((pl) => {
          const { car } = pl
          const p = view.toScreen(pl.kind === 'track' ? model.pointBeside(pl.distance, pl.lateral ?? 0) : pl.point)
          return (
            <CarDot key={car.id} car={car} p={p} dim={pl.dim} scale={1 / Math.sqrt(zoom)}
              hovered={car.id === hoverId || highlightIds.includes(car.id)} focused={car.id === focusId} pinned={pinned.includes(car.carNumber)}
              ghosted={car.id === pitGhost?.car.id} onHover={onHover} onTogglePin={onTogglePin} />
          )
        })}
      </svg>
      {!awaitingCalibration && !sync.synced && (
        <div className="map-sync" role="status">
          <span className="map-sync-dot" aria-hidden />
          Syncing car positions · {sync.updated}/{sync.total} cars
        </div>
      )}
      {awaitingCalibration && (
        <div className={`map-overlay${note ? ' map-note' : ''}`}>{note ?? 'Learning where the timing points are from live pace. Cars appear after a lap or two.'}</div>
      )}
      </div>
      {track.elevation && track.elevation.length > 0 && (
        <ElevationStrip track={track} elevation={track.elevation} cars={stripCars} caution={flagNow === 'caution'}
          hoverId={hoverId} pinned={pinned} onHover={onHover} />
      )}
      <div className="map-caption">
        {track.name} · positions estimated between timing points
        {track.provisional && ' · provisional map: timing points placed from live pace'}
        {track.controlLineEstimated && ' · start/finish position estimated'}
        {' · '}scroll or pinch to zoom, drag to pan · {track.source.attribution}
      </div>
    </div>
  )
}

/** Wheel / pinch zoom about the pointer, and drag to pan. Pan is in screen (viewBox) units. */
function useZoomPan(fit: { x: number; y: number; w: number; h: number }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const state = useRef({ zoom: 1, pan: { x: 0, y: 0 } })
  state.current = { zoom, pan }
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; moved: boolean } | null>(null)

  // Reset when the view (track or rotation) changes.
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [fit])

  /** Screen pixels -> viewBox units, for the current zoom. */
  const unitsPerPixel = () => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return 1
    // preserveAspectRatio "meet": the larger ratio wins.
    return Math.max(fit.w / rect.width, fit.h / rect.height) / state.current.zoom
  }

  /** Zoom by `factor`, keeping the point under (clientX, clientY) fixed. */
  const zoomAt = (factor: number, clientX?: number, clientY?: number) => {
    const { zoom: z, pan: p } = state.current
    const next = Math.min(MAX_ZOOM, Math.max(1, z * factor))
    if (next === z) return
    const rect = svgRef.current?.getBoundingClientRect()
    let nx = p.x
    let ny = p.y
    if (rect && clientX !== undefined && clientY !== undefined) {
      const upp = unitsPerPixel()
      const dx = (clientX - (rect.left + rect.width / 2)) * upp
      const dy = (clientY - (rect.top + rect.height / 2)) * upp
      nx = p.x + dx * (1 - z / next)
      ny = p.y + dy * (1 - z / next)
    }
    if (next === 1) { nx = 0; ny = 0 }
    setZoom(next)
    setPan({ x: nx, y: ny })
  }

  // Wheel needs a non-passive listener so we can stop the page scrolling.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAt reads zoom/pan from a ref; only fit matters
  }, [fit])

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<SVGSVGElement>) => {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      gesture.current = { dist: pinchDistance(), moved: false }
    },
    onPointerMove: (e: ReactPointerEvent<SVGSVGElement>) => {
      const prev = pointers.current.get(e.pointerId)
      if (!prev || !gesture.current) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size >= 2) {
        // Pinch: zoom by the change in finger distance, about their midpoint.
        const dist = pinchDistance()
        const mid = [...pointers.current.values()].reduce((a, p) => ({ x: a.x + p.x / 2, y: a.y + p.y / 2 }), { x: 0, y: 0 })
        if (gesture.current.dist > 0) zoomAt(dist / gesture.current.dist, mid.x, mid.y)
        gesture.current = { dist, moved: true }
        return
      }
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      if (!gesture.current.moved && Math.hypot(dx, dy) < 3) return
      if (!gesture.current.moved) e.currentTarget.setPointerCapture(e.pointerId)
      gesture.current.moved = true
      if (state.current.zoom <= 1) return // nothing to pan when fully zoomed out
      const upp = unitsPerPixel()
      setPan((p) => ({ x: p.x - dx * upp, y: p.y - dy * upp }))
    },
    onPointerUp: (e: ReactPointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size === 0) gesture.current = null
    },
    onPointerCancel: (e: ReactPointerEvent<SVGSVGElement>) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size === 0) gesture.current = null
    },
  }

  function pinchDistance() {
    const ps = [...pointers.current.values()]
    return ps.length >= 2 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0
  }

  return {
    zoom, pan, svgRef, handlers,
    zoomBy: (f: number) => zoomAt(f, ...centreOfSvg()),
    reset: () => { setZoom(1); setPan({ x: 0, y: 0 }) },
  }

  function centreOfSvg(): [number, number] | [] {
    const r = svgRef.current?.getBoundingClientRect()
    return r ? [r.left + r.width / 2, r.top + r.height / 2] : []
  }
}

type View = ReturnType<typeof makeView>


function CarDot({ car, p, dim, scale, hovered, focused, pinned, ghosted = false, onHover, onTogglePin }: {
  car: CarRow; p: Vec; dim: boolean; scale: number; hovered: boolean; focused: boolean; pinned: boolean
  /** The car with the pit rejoin estimate on: a violet ring and number, like its ghost. */
  ghosted?: boolean
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
}) {
  const classes = ['map-car', `mfr-${car.manufacturer.toLowerCase()}`, dim && 'dim', hovered && 'hovered', focused && 'focused', pinned && 'pinned', ghosted && 'ghosted']
  const big = hovered || pinned || focused || ghosted
  return (
    <g
      transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${scale.toFixed(3)})`}
      className={classes.filter(Boolean).join(' ')}
      onMouseEnter={() => onHover(car.id)}
      onMouseLeave={() => onHover(null)}
      onDoubleClick={() => onTogglePin(car.carNumber)}
    >
      <title>{`P${car.position} #${car.carNumber} ${car.driver}${car.inPit ? ' (pit)' : ''}`}</title>
      {(pinned || focused) && <circle r={CAR_RADIUS * 1.7} className={focused ? 'focus-ring' : 'pin-ring'} />}
      {ghosted && <circle r={CAR_RADIUS * 1.55} className="ghost-car-ring" />}
      <circle className="car-body" r={big ? CAR_RADIUS * 1.3 : CAR_RADIUS} style={teamStyle(car, 'fill')} />
      <text dy="0.36em">{car.carNumber}</text>
    </g>
  )
}

function ControlLine({ view, model }: { view: View; model: TrackModel }) {
  const p = view.toScreen(model.pointAt(0))
  const n = view.dirToScreen(model.normalAt(0))
  const half = 40
  return <line className="control-line" x1={p.x - n.x * half} y1={p.y - n.y * half} x2={p.x + n.x * half} y2={p.y + n.y * half} />
}

/** Corner name placed on the outside of the track (away from the circuit's centre), always upright. */
function Label({ view, model, name, distance }: { view: View; model: TrackModel; name: string; distance: number }) {
  const p = view.toScreen(model.pointAt(distance))
  const n = view.dirToScreen(model.normalAt(distance))
  const outward = (p.x - view.centre.x) * n.x + (p.y - view.centre.y) * n.y > 0 ? 1 : -1
  const x = p.x + n.x * 70 * outward
  const y = p.y + n.y * 70 * outward
  const side = n.x * outward
  const anchor = side > 0.3 ? 'start' : side < -0.3 ? 'end' : 'middle'
  return <text className="corner-label" x={x} y={y} textAnchor={anchor} dy="0.35em">{name}</text>
}
