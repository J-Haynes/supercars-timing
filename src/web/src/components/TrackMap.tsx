import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CarRow, TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { TrackModel, type Vec } from '../map/trackModel'
import { carPosition } from '../map/carPosition'
import { useSessionClock } from '../map/useSessionClock'
import { isRace } from '../session'

const CAR_RADIUS = 46 // metres, in map units
const PIT_SPACING = 70
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

export function TrackMap({ track, update, hoverId, focusId, pinned, rotation, onRotate, onHover, onTogglePin }: {
  track: TrackDefinition
  update: TimingUpdate
  hoverId: string | null
  /** Car to emphasise automatically (e.g. the car on its Shootout lap). */
  focusId?: string | null
  pinned: string[]
  rotation: number
  onRotate: (degrees: number) => void
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
}) {
  const model = useMemo(() => new TrackModel(track), [track])
  const view = useMemo(() => makeView(model, rotation), [model, rotation])
  const { zoom, pan, svgRef, handlers, zoomBy, reset } = useZoomPan(view.fit)

  const { timing, feed } = update
  const now = useSessionClock(timing.now, feed.state === 'live' || feed.state === 'replaying' ? feed.clockRate ?? 1 : 0)
  const order = useMemo(() => ['M', ...timing.timingPoints.map((p) => p.id)], [timing.timingPoints])
  const baseline = useMemo(
    () => order.map((id) => track.segmentSeconds.find((s) => s.from === id)?.seconds || 0),
    [order, track.segmentSeconds],
  )
  const fallback = useMemo(() => order.map((_, i) => timing.segmentReference?.[i] || baseline[i]), [order, timing.segmentReference, baseline])
  const cap = isRace(timing.session.type) ? undefined : baseline

  // Draw order: later = on top. Leader above the field, then pinned, focused, and the hovered car on top.
  const layer = (c: CarRow) => (c.id === hoverId ? 3 : c.id === focusId ? 2 : pinned.includes(c.carNumber) ? 1 : 0)
  const cars = [...timing.cars].sort((a, b) => layer(a) - layer(b) || (b.position || 99) - (a.position || 99))
  let pitIndex = 0

  const w = view.fit.w / zoom
  const h = view.fit.h / zoom
  const viewBox = `${view.fit.x + view.fit.w / 2 - w / 2 + pan.x} ${view.fit.y + view.fit.h / 2 - h / 2 + pan.y} ${w} ${h}`
  const s = (d: number) => view.toScreen(model.pointAt(d))

  return (
    <div className="track-map">
      <div className="map-tools" role="toolbar" aria-label="Map view">
        <button type="button" onClick={() => onRotate(rotation - 15)} title="Rotate left">⟲</button>
        <button type="button" onClick={() => onRotate(rotation + 15)} title="Rotate right">⟳</button>
        <button type="button" onClick={() => zoomBy(1.4)} title="Zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.4)} title="Zoom out">−</button>
        <button type="button" onClick={() => { reset(); onRotate(0) }} title="Reset view" className="wide">Reset</button>
      </div>
      <svg ref={svgRef} viewBox={viewBox} role="img" aria-label={`${track.name} track map`} {...handlers}
        className={zoom > 1 ? 'zoomed' : ''}>
        <path d={view.path} className="track-outline" />
        <path d={view.path} className="track-surface" />
        {track.pitLane.length > 1 && <path d={view.pit} className="pit-lane" />}
        <ControlLine view={view} model={model} />
        {track.timingPoints.filter((p) => p.id !== 'M').map((p) => {
          const pt = s(p.distance)
          return <circle key={p.id} cx={pt.x} cy={pt.y} r={9} className="timing-point"><title>{p.name}</title></circle>
        })}
        <g style={{ fontSize: 44 / Math.sqrt(zoom) }}>
          {track.labels.filter((l) => !HIDDEN_LABELS.test(l.name)).map((l) => (
            <Label key={l.name} view={view} model={model} name={l.name} distance={l.distance} />
          ))}
        </g>
        {cars.map((car) => {
          const state = carPosition(car, model, order, fallback, now, cap)
          let p: Vec
          if (state.kind === 'track') p = s(state.distance)
          else if (state.kind === 'pit' && track.pitLane.length > 1) p = view.toScreen(pitSlot(model, pitIndex++))
          else return null
          const dim = state.kind === 'pit' || (state.kind === 'track' && state.stale)
          return (
            <CarDot key={car.id} car={car} p={p} dim={dim} scale={1 / Math.sqrt(zoom)}
              hovered={car.id === hoverId} focused={car.id === focusId} pinned={pinned.includes(car.carNumber)}
              onHover={onHover} onTogglePin={onTogglePin} />
          )
        })}
      </svg>
      <div className="map-caption">
        {track.name} · positions estimated between timing points · scroll or pinch to zoom, drag to pan · {track.source.attribution}
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

function CarDot({ car, p, dim, scale, hovered, focused, pinned, onHover, onTogglePin }: {
  car: CarRow; p: Vec; dim: boolean; scale: number; hovered: boolean; focused: boolean; pinned: boolean
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
}) {
  const classes = ['map-car', `mfr-${car.manufacturer.toLowerCase()}`, dim && 'dim', hovered && 'hovered', focused && 'focused', pinned && 'pinned']
  const big = hovered || pinned || focused
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
      <circle r={big ? CAR_RADIUS * 1.3 : CAR_RADIUS} />
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

/** Spreads cars in the pit lane out along it from the middle, so they don't stack on one spot. */
function pitSlot(model: TrackModel, index: number): Vec {
  const pit = model.def.pitLane
  const cum = [0]
  for (let i = 1; i < pit.length; i++) cum.push(cum[i - 1] + Math.hypot(pit[i][0] - pit[i - 1][0], pit[i][1] - pit[i - 1][1]))
  const total = cum[cum.length - 1]
  const offset = Math.ceil(index / 2) * PIT_SPACING * (index % 2 ? 1 : -1)
  const d = Math.min(Math.max(total / 2 + offset, 0), total)
  let i = 1
  while (i < cum.length - 1 && cum[i] < d) i++
  const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
  return { x: pit[i - 1][0] + t * (pit[i][0] - pit[i - 1][0]), y: pit[i - 1][1] + t * (pit[i][1] - pit[i - 1][1]) }
}
