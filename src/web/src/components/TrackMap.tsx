import { useMemo } from 'react'
import type { CarRow, TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { TrackModel } from '../map/trackModel'
import { carPosition } from '../map/carPosition'
import { useSessionClock } from '../map/useSessionClock'

const CAR_RADIUS = 46 // metres, in map units
const PIT_SPACING = 70
// Labels that would sit on top of the start/finish area and its cars.
const HIDDEN_LABELS = /line$|^pit straight$/i

export function TrackMap({ track, update, hoverId, pinned, onHover, onTogglePin }: {
  track: TrackDefinition
  update: TimingUpdate
  hoverId: string | null
  pinned: string[]
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
}) {
  const model = useMemo(() => new TrackModel(track), [track])
  const geometry = useMemo(() => {
    const b = model.bounds()
    // Extra room left/right for corner labels.
    const padX = 480
    const padY = 160
    return {
      viewBox: `${b.minX - padX} ${b.minY - padY} ${b.maxX - b.minX + padX * 2} ${b.maxY - b.minY + padY * 2}`,
      path: model.pathData(),
      pit: model.pitLaneData(),
      centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
    }
  }, [model])

  const { timing, feed } = update
  const now = useSessionClock(timing.now, feed.state === 'live' || feed.state === 'replaying' ? feed.clockRate ?? 1 : 0)
  const order = useMemo(() => ['M', ...timing.timingPoints.map((p) => p.id)], [timing.timingPoints])
  const fallback = useMemo(
    () => order.map((id, i) => timing.segmentReference?.[i] || track.segmentSeconds.find((s) => s.from === id)?.seconds || 0),
    [order, timing.segmentReference, track.segmentSeconds],
  )

  // Draw order: later = on top. Leader above the field, pinned cars above that, the hovered car above all.
  const layer = (c: CarRow) => (c.id === hoverId ? 2 : pinned.includes(c.carNumber) ? 1 : 0)
  const cars = [...timing.cars].sort((a, b) => layer(a) - layer(b) || (b.position || 99) - (a.position || 99))
  let pitIndex = 0

  return (
    <div className="track-map">
      <svg viewBox={geometry.viewBox} role="img" aria-label={`${track.name} track map`}>
        <path d={geometry.path} className="track-outline" />
        <path d={geometry.path} className="track-surface" />
        {track.pitLane.length > 1 && <path d={geometry.pit} className="pit-lane" />}
        <ControlLine model={model} />
        {track.timingPoints.filter((p) => p.id !== 'M').map((p) => {
          const pt = model.pointAt(p.distance)
          return <circle key={p.id} cx={pt.x} cy={-pt.y} r={9} className="timing-point"><title>{p.name}</title></circle>
        })}
        {track.labels.filter((l) => !HIDDEN_LABELS.test(l.name)).map((l) => (
          <Label key={l.name} model={model} name={l.name} distance={l.distance} centre={geometry.centre} />
        ))}
        {cars.map((car) => {
          const state = carPosition(car, model, order, fallback, now)
          let x: number, y: number
          if (state.kind === 'track') {
            const p = model.pointAt(state.distance)
            ;[x, y] = [p.x, -p.y]
          } else if (state.kind === 'pit' && track.pitLane.length > 1) {
            const p = pitSlot(model, pitIndex++)
            ;[x, y] = [p.x, -p.y]
          } else return null
          const dim = state.kind === 'pit' || (state.kind === 'track' && state.stale)
          return (
            <CarDot key={car.id} car={car} x={x} y={y} dim={dim}
              hovered={car.id === hoverId} pinned={pinned.includes(car.carNumber)}
              onHover={onHover} onTogglePin={onTogglePin} />
          )
        })}
      </svg>
      <div className="map-caption">
        {track.name} · positions estimated between timing points · {track.source.attribution}
      </div>
    </div>
  )
}

function CarDot({ car, x, y, dim, hovered, pinned, onHover, onTogglePin }: {
  car: CarRow; x: number; y: number; dim: boolean; hovered: boolean; pinned: boolean
  onHover: (id: string | null) => void
  onTogglePin: (carNumber: string) => void
}) {
  const classes = ['map-car', `mfr-${car.manufacturer.toLowerCase()}`, dim && 'dim', hovered && 'hovered', pinned && 'pinned']
  return (
    <g
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
      className={classes.filter(Boolean).join(' ')}
      onMouseEnter={() => onHover(car.id)}
      onMouseLeave={() => onHover(null)}
      onDoubleClick={() => onTogglePin(car.carNumber)}
    >
      <title>{`P${car.position} #${car.carNumber} ${car.driver}${car.inPit ? ' (pit)' : ''}`}</title>
      {pinned && <circle r={CAR_RADIUS * 1.7} className="pin-ring" />}
      <circle r={hovered || pinned ? CAR_RADIUS * 1.3 : CAR_RADIUS} />
      <text dy="0.36em">{car.carNumber}</text>
    </g>
  )
}

function ControlLine({ model }: { model: TrackModel }) {
  const p = model.pointAt(0)
  const n = model.normalAt(0)
  const half = 40
  return (
    <line className="control-line" x1={p.x - n.x * half} y1={-(p.y - n.y * half)} x2={p.x + n.x * half} y2={-(p.y + n.y * half)} />
  )
}

/** Corner name placed on the outside of the track (away from the circuit's centre). */
function Label({ model, name, distance, centre }: { model: TrackModel; name: string; distance: number; centre: { x: number; y: number } }) {
  const p = model.pointAt(distance)
  const n = model.normalAt(distance)
  const svgP = { x: p.x, y: -p.y }
  const svgN = { x: n.x, y: -n.y }
  const outward = (svgP.x - centre.x) * svgN.x + (svgP.y - centre.y) * svgN.y > 0 ? 1 : -1
  const off = 70 * outward
  const x = svgP.x + svgN.x * off
  const y = svgP.y + svgN.y * off
  const anchor = svgN.x * outward > 0.3 ? 'start' : svgN.x * outward < -0.3 ? 'end' : 'middle'
  return <text className="corner-label" x={x} y={y} textAnchor={anchor} dy="0.35em">{name}</text>
}

/** Spreads cars in the pit lane out along it from the middle, so they don't stack on one spot. */
function pitSlot(model: TrackModel, index: number) {
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
