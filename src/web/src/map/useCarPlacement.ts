import { useEffect, useMemo, useRef } from 'react'
import { isF1 } from '../series'
import type { CarRow, TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { TrackModel, type Vec } from './trackModel'
import { carPosition, cautionPace, F1_PACING, SUPERCARS_PACING } from './carPosition'
import { useSessionClock } from './useSessionClock'
import { cautionPeriods, flagKind, isRace, isShootout } from '../session'
import { calibrateTimingPoints } from './calibrate'
import { usePositionSync } from './usePositionSync'
import { TAU, TAU_CAUTION, smoothPosition, type Smoothed } from './smoothing'
import { CrossingLog, knownPosition } from './crossingLog'

const PIT_SPACING = 70

/** Where a car is drawn this frame. Track cars have a distance along the lap; pit cars a point (track metres). */
export type Placement =
  | { car: CarRow; kind: 'track'; distance: number; dim: boolean }
  | { car: CarRow; kind: 'pit'; point: Vec; dim: true }

/**
 * Places every car for the current frame: the session clock, provisional timing points, the crossing log for a
 * broadcast delay, pacing and smoothing. Shared by the 2D map (TrackMap) and the 3D map (TrackMap3D), so both show
 * cars in the same place. Re-renders every animation frame (the session clock ticks).
 */
export function useCarPlacement(track: TrackDefinition, update: TimingUpdate, live?: TimingUpdate | null) {
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

  const model = useMemo(() => new TrackModel(effective), [effective])     // with timing points: car positions
  const baseline = useMemo(
    () => order.map((id) => track.segmentSeconds.find((s) => s.from === id)?.seconds || 0),
    [order, track.segmentSeconds],
  )
  const fallback = useMemo(() => order.map((_, i) => timing.segmentReference?.[i] || baseline[i]), [order, timing.segmentReference, baseline])
  const cap = isRace(timing.session.type) ? undefined : baseline
  // Safety car / FCY out now: pace cars at the field's caution pace (map/carPosition.ts, cautionPace).
  const openCaution = cautionPeriods(timing.flagHistory).at(-1)
  const caution = flagNow === 'caution' && openCaution && openCaution.end === undefined
    ? cautionPace(timing.cars, order, baseline, openCaution.start, timing.now)
    : undefined

  // In the Shootout, show cars on their out-lap, flying lap and in-lap, and hide them once they're back in the
  // pits. Natsoft doesn't flag the pit entry after the in-lap; the car just stops crossing timing points. So an
  // in-lap car that's past the last timing point and overdue at the line has gone into the pit lane.
  const shootout = isShootout(timing.session.name, timing.session.type)
  const lastPointId = order[order.length - 1]

  // Back of the field first, so pit slots are handed out in a stable order.
  const placements: Placement[] = []
  let pitIndex = 0
  for (const row of [...mapCars].sort((a, b) => (b.position || 99) - (a.position || 99))) {
    // With a broadcast delay the live feed may already have a newer crossing than the delayed snapshot (the
    // snapshot only shows it a moment after it happened): estimate on from that one, or the car stepped back.
    const seen = live && !row.inPit ? crossings.current.latest(row.id, now) : undefined
    const car = seen && seen.at > row.lastPointAt ? { ...row, lastPoint: seen.point, lastPointAt: seen.at } : row
    if (shootout && car.inPit) continue
    const inLap = shootout && car.lapsSincePit >= 2
    // In-laps are slow: don't cap them at racing pace.
    const state = carPosition(car, model, order, fallback, now, inLap ? undefined : cap, baseline, caution, isF1 ? F1_PACING : SUPERCARS_PACING)
    if (inLap && state.kind === 'track' && (state.stale || (car.lastPoint === lastPointId && state.overdue))) continue
    if (state.kind === 'track') {
      // Known from the live feed (broadcast delay): where the car really was between two crossings.
      const pair = live ? crossings.current.around(car.id, now) : undefined
      const distance = (pair && knownPosition(model, pair[0], pair[1], now)) ?? state.distance
      const sm = smoothPosition(smoothing.current.get(car.id), car.lastPointAt, distance, now, model.length, caution ? TAU_CAUTION : TAU)
      smoothing.current.set(car.id, sm)
      placements.push({ car, kind: 'track', distance: model.wrap(sm.shown), dim: state.stale })
    } else if (state.kind === 'pit') {
      const point = track.pitLane.length > 1 ? pitSlot(model, pitIndex++) : pitAreaSlot(model, pitIndex++)
      placements.push({ car, kind: 'pit', point, dim: true })
    }
  }

  return { now, model, effective, placements, sync, awaitingCalibration, flagNow, caution: !!caution }
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
