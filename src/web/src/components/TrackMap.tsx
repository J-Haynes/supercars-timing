import { isF1, teamStyle } from '../series'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { CarRow, TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { TrackModel, type Vec } from '../map/trackModel'
import { carPosition, cautionPace, F1_PACING, SUPERCARS_PACING } from '../map/carPosition'
import { useSessionClock } from '../map/useSessionClock'
import { cautionPeriods, flagKind, isRace, isShootout } from '../session'
import { calibrateTimingPoints } from '../map/calibrate'
import { usePositionSync } from '../map/usePositionSync'
import { TAU, TAU_CAUTION, smoothPosition, type Smoothed } from '../map/smoothing'
import { CrossingLog, knownPosition } from '../map/crossingLog'

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

export function TrackMap({ track, update, live, hoverId, highlightIds = [], focusId, pinned, rotation, onRotate, onHover, onTogglePin, note }: {
  track: TrackDefinition
  update: TimingUpdate
  /** The live (undelayed) update. With a broadcast delay it's ahead of `update`: cars are placed between the
   * crossings either side of the time shown instead of estimated (map/crossingLog.ts). */
  live?: TimingUpdate | null
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
}) {
  const { timing, feed } = update
  const now = useSessionClock(timing.now, feed.state === 'live' || feed.state === 'replaying' ? feed.clockRate ?? 1 : 0)
  const order = useMemo(() => ['M', ...timing.timingPoints.map((p) => p.id)], [timing.timingPoints])

  // Provisional tracks have no timing point positions yet: learn them from live pace, and keep them stable
  // (only re-place if the typical lap changes by more than 3%, e.g. after a damp start dries out).
  const calibration = useRef<{ key: string; total: number; points: TrackDefinition['timingPoints'] } | null>(null)
  const calibrated = useMemo(() => {
    if (!track.provisional) return null
    const key = `${track.code}|${timing.session.name}|${order.join(',')}`
    const names = Object.fromEntries(timing.timingPoints.map((p) => [p.id, p.name]))
    const points = calibrateTimingPoints(track, order, names, timing.segmentReference)
    const total = (timing.segmentReference ?? []).reduce((a, b) => a + b, 0)
    const frozen = calibration.current
    if (points && (!frozen || frozen.key !== key || Math.abs(total - frozen.total) / frozen.total > 0.03)) {
      calibration.current = { key, total, points }
    } else if (frozen && frozen.key !== key) {
      calibration.current = null
    }
    return calibration.current?.points ?? null
  }, [track, order, timing.session.name, timing.timingPoints, timing.segmentReference])
  const effective = useMemo(() => (calibrated ? { ...track, timingPoints: calibrated } : track), [track, calibrated])
  const awaitingCalibration = !!track.provisional && !calibrated
  const crossings = useRef(new CrossingLog())
  useEffect(() => {
    if (live) crossings.current.add(live)
  }, [live])
  // Per-car dot smoothing across timing point crossings (map/smoothing.ts). Visual only.
  const smoothing = useRef(new Map<string, Smoothed>())
  // Just after the page loads, positions come from crossings made before it; say so until most cars have updated.
  const flagNow = flagKind(timing.session.flag)
  // Retired cars (F1 sends Retired) leave the map; they'd otherwise sit where they stopped and hold up the sync.
  const mapCars = timing.cars.filter((c) => !c.retired)
  const sync = usePositionSync(mapCars, `${timing.session.meeting}|${timing.session.name}`, flagNow === 'green' || flagNow === 'caution')

  const geometry = useMemo(() => new TrackModel(track), [track])          // outline only: stable for the view
  const model = useMemo(() => new TrackModel(effective), [effective])     // with timing points: car positions
  const view = useMemo(() => makeView(geometry, rotation), [geometry, rotation])
  const { zoom, pan, svgRef, handlers, zoomBy, reset } = useZoomPan(view.fit)

  const baseline = useMemo(
    () => order.map((id) => track.segmentSeconds.find((s) => s.from === id)?.seconds || 0),
    [order, track.segmentSeconds],
  )
  const fallback = useMemo(() => order.map((_, i) => timing.segmentReference?.[i] || baseline[i]), [order, timing.segmentReference, baseline])
  const cap = isRace(timing.session.type) ? undefined : baseline
  // Safety car / FCY out now: pace cars at the field's caution pace (map/carPosition.ts, cautionPace).
  const openCaution = cautionPeriods(timing.flagHistory).at(-1)
  const caution = flagKind(timing.session.flag) === 'caution' && openCaution && openCaution.end === undefined
    ? cautionPace(timing.cars, order, baseline, openCaution.start, timing.now)
    : undefined

  // Draw order: later = on top. Leader above the field, then pinned, focused, and the hovered car on top.
  const layer = (c: CarRow) => (c.id === hoverId || highlightIds.includes(c.id) ? 3 : c.id === focusId ? 2 : pinned.includes(c.carNumber) ? 1 : 0)
  const cars = [...mapCars].sort((a, b) => layer(a) - layer(b) || (b.position || 99) - (a.position || 99))
  let pitIndex = 0
  // In the Shootout, show cars on their out-lap, flying lap and in-lap, and hide them once they're back in the
  // pits. Natsoft doesn't flag the pit entry after the in-lap; the car just stops crossing timing points. So an
  // in-lap car that's past the last timing point and overdue at the line has gone into the pit lane.
  const shootout = isShootout(timing.session.name, timing.session.type)
  const lastPointId = order[order.length - 1]

  const w = view.fit.w / zoom
  const h = view.fit.h / zoom
  const viewBox = `${view.fit.x + view.fit.w / 2 - w / 2 + pan.x} ${view.fit.y + view.fit.h / 2 - h / 2 + pan.y} ${w} ${h}`
  const s = (d: number) => view.toScreen(model.pointAt(d))

  return (
    <div className={`track-map${!awaitingCalibration && !sync.synced ? ' syncing' : ''}`}>
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
        {effective.timingPoints.filter((p) => p.id !== 'M').map((p) => {
          const pt = s(p.distance)
          return <circle key={p.id} cx={pt.x} cy={pt.y} r={9} className="timing-point"><title>{p.name}</title></circle>
        })}
        <g style={{ fontSize: 44 / Math.sqrt(zoom) }}>
          {track.labels.filter((l) => !HIDDEN_LABELS.test(l.name)).map((l) => (
            <Label key={l.name} view={view} model={model} name={l.name} distance={l.distance} />
          ))}
        </g>
        {cars.map((row) => {
          // With a broadcast delay the live feed may already have a newer crossing than the delayed snapshot (the
          // snapshot only shows it a moment after it happened): estimate on from that one, or the car stepped back.
          const seen = live && !row.inPit ? crossings.current.latest(row.id, now) : undefined
          const car = seen && seen.at > row.lastPointAt ? { ...row, lastPoint: seen.point, lastPointAt: seen.at } : row
          if (shootout && car.inPit) return null
          const inLap = shootout && car.lapsSincePit >= 2
          // In-laps are slow: don't cap them at racing pace.
          const state = carPosition(car, model, order, fallback, now, inLap ? undefined : cap, baseline, caution, isF1 ? F1_PACING : SUPERCARS_PACING)
          if (inLap && state.kind === 'track' && (state.stale || (car.lastPoint === lastPointId && state.overdue))) return null
          let p: Vec
          if (state.kind === 'track') {
            // Known from the live feed (broadcast delay): where the car really was between two crossings.
            const pair = live ? crossings.current.around(car.id, now) : undefined
            const distance = (pair && knownPosition(model, pair[0], pair[1], now)) ?? state.distance
            const sm = smoothPosition(smoothing.current.get(car.id), car.lastPointAt, distance, now, model.length, caution ? TAU_CAUTION : TAU)
            smoothing.current.set(car.id, sm)
            p = s(sm.shown)
          }
          else if (state.kind === 'pit') p = view.toScreen(track.pitLane.length > 1 ? pitSlot(model, pitIndex++) : pitAreaSlot(model, pitIndex++))
          else return null
          const dim = state.kind === 'pit' || (state.kind === 'track' && state.stale)
          return (
            <CarDot key={car.id} car={car} p={p} dim={dim} scale={1 / Math.sqrt(zoom)}
              hovered={car.id === hoverId || highlightIds.includes(car.id)} focused={car.id === focusId} pinned={pinned.includes(car.carNumber)}
              onHover={onHover} onTogglePin={onTogglePin} />
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
      <circle r={big ? CAR_RADIUS * 1.3 : CAR_RADIUS} style={teamStyle(car, 'fill')} />
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

/** For tracks without a mapped pit lane: a row beside the control line. */
function pitAreaSlot(model: TrackModel, index: number): Vec {
  const n = model.normalAt(0)
  const offset = (Math.ceil(index / 2) * PIT_SPACING * (index % 2 ? 1 : -1))
  const p = model.pointAt(offset)
  return { x: p.x + n.x * 110, y: p.y + n.y * 110 }
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
