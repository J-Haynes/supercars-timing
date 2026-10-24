import { useEffect, useMemo, useRef } from 'react'
import { isF1 } from '../series'
import type { CarRow, TimingUpdate } from '../types'
import type { TrackDefinition } from '../tracks/types'
import { TrackModel, type Vec } from './trackModel'
import { carPosition, cautionPace, placeBetween, F1_PACING, SUPERCARS_PACING } from './carPosition'
import { useSessionClock } from './useSessionClock'
import { cautionPeriods, flagKind, isRace, isShootout } from '../session'
import { calibrateTimingPoints } from './calibrate'
import { usePositionSync } from './usePositionSync'
import { TAU, TAU_CAUTION, smoothPosition, type Smoothed } from './smoothing'
import { CrossingLog, knownPosition, type Crossing, type MapFeed } from './crossingLog'
import { useReferenceFallback } from './useReferenceFallback'
import { gridPlaces, gridSlot, launchDistance, onGrid, preStartDistance, type GridSlot } from './startGrid'
import { standingRestart } from './standingRestart'
import { teamsRoundFor } from '../teams'

const PIT_SPACING = 70
/** Garages span this part of the pit lane (shares of its length from the entry): the ends are entry and exit roads. */
const GARAGES_FROM = 0.2
const GARAGES_TO = 0.8
/** After the green flag, cars without a crossing yet are launched from their grid slot for this long (seconds). */
const LAUNCH_SECONDS = 120

/**
 * Where a car is drawn this frame. Track cars have a distance along the lap (and, on the starting grid, a sideways
 * offset in metres, left of race direction); pit cars a point (track metres).
 */
export type Placement =
  | { car: CarRow; kind: 'track'; distance: number; dim: boolean; lateral?: number }
  | { car: CarRow; kind: 'pit'; point: Vec; dim: boolean }

/**
 * Places every car for the current frame: the session clock, provisional timing points, the crossing log for a
 * broadcast delay, pacing and smoothing. Shared by the 2D map (TrackMap) and the 3D map (TrackMap3D), so both show
 * cars in the same place. Re-renders every animation frame (the session clock ticks).
 */
export function useCarPlacement(track: TrackDefinition, update: TimingUpdate, live?: MapFeed | null) {
  const { timing, feed } = update
  const now = useSessionClock(timing.now, feed.state === 'live' || feed.state === 'replaying' ? feed.clockRate ?? 1 : 0)
  const order = useMemo(() => ['M', ...timing.timingPoints.map((p) => p.id)], [timing.timingPoints])

  // Provisional tracks have no timing point positions yet: learn them from live pace, and keep them stable
  // (only re-place if the typical lap changes by more than 3%, e.g. after a damp start dries out).
  const calibration = useRef<{ key: string; total: number; points: TrackDefinition['timingPoints'] } | null>(null)
  // Until this session has timed every stretch, use an earlier session's at this track (useReferenceFallback).
  const own = timing.segmentReference
  const ownComplete = !!own && own.length === order.length && own.every((x) => x > 0)
  const fallbackReference = useReferenceFallback(track.code, order, !!track.provisional && !ownComplete)
  const reference = ownComplete ? own : fallbackReference ?? own
  const calibrated = useMemo(() => {
    if (!track.provisional) return null
    const key = `${track.code}|${timing.session.name}|${order.join(',')}`
    const names = Object.fromEntries(timing.timingPoints.map((p) => [p.id, p.name]))
    const points = calibrateTimingPoints(track, order, names, reference ?? undefined)
    const total = (reference ?? []).reduce((a, b) => a + b, 0)
    const frozen = calibration.current
    if (points && (!frozen || frozen.key !== key || Math.abs(total - frozen.total) / frozen.total > 0.03)) {
      calibration.current = { key, total, points }
    } else if (frozen && frozen.key !== key) {
      calibration.current = null
    }
    return calibration.current?.points ?? null
  }, [track, order, timing.session.name, timing.timingPoints, reference])
  const effective = useMemo(() => (calibrated ? { ...track, timingPoints: calibrated } : track), [track, calibrated])
  const awaitingCalibration = !!track.provisional && !calibrated
  const crossings = useRef(new CrossingLog())
  useEffect(() => {
    if (live) crossings.current.add(live)
  }, [live])
  // A replay's fill of a jump in its lookahead (MapFeed): the crossings polling skipped.
  const between = live?.between
  useEffect(() => {
    for (const timing of between ?? []) crossings.current.addPast({ feed: update.feed, timing })
  }, [between]) // eslint-disable-line react-hooks/exhaustive-deps -- only when a new fill arrives
  // The snapshot on screen too: every car's crossing at or before the time shown is then known straight away.
  useEffect(() => {
    if (live) crossings.current.addPast(update)
  }, [live, update])
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

  // The start of a race (map/startGrid.ts): cars on the grid in grid order before the green flag, then each one
  // launched from its slot to its first crossing. The green flag's time from the snapshot, or from the live feed /
  // replay lookahead when it's ahead (it then knows the start to the second, before the snapshot shows it).
  const race = isRace(timing.session.type)
  const sameSession = live && live.timing.session.meeting === timing.session.meeting && live.timing.session.name === timing.session.name
  const green = timing.session.greenAt || (sameSession ? live.timing.session.greenAt : 0) || 0
  const started = green > 0 && now >= green
  const preStart = race && !started && flagNow === 'other'
  const grid = useRef<{ key: string; places: Map<string, number> } | null>(null)
  const gridKey = `${timing.session.meeting}|${timing.session.name}`
  // Kept up to date while waiting for the start (cars join from the pit lane), then kept as it was once racing:
  // positions change at the first crossings. Opening a replay mid-launch takes the order at that moment.
  if (race && (preStart || (started && now - green < LAUNCH_SECONDS && grid.current?.key !== gridKey))) {
    grid.current = { key: gridKey, places: gridPlaces(timing.session, mapCars) }
  }
  const slotOf = (car: CarRow) => {
    const place = grid.current?.key === gridKey ? grid.current.places.get(car.id) : undefined
    return place ? gridSlot(model, place) : undefined
  }
  // The track's flying-lap times: the session's own reference is from formation and out-laps at a start.
  const stretches = baseline.map((b, i) => b || fallback[i])
  const skipAfter = (isF1 ? F1_PACING : SUPERCARS_PACING).skipAfter
  // A standing restart after a red flag (map/standingRestart.ts): the grid again, from the crossing log.
  const restart = race && live && started
    ? standingRestart(timing, sameSession ? live.timing : undefined, crossings.current, model, order, stretches, now)
    : undefined

  // A car launching from its grid slot `distance` along the lap, smoothed; it fans in from the two-wide grid to the
  // racing line over the first ~150 m.
  const launched = (car: CarRow, slot: GridSlot, distance: number): Placement => {
    const sm = smoothPosition(smoothing.current.get(car.id), car.lastPointAt, distance, now, model.length, TAU)
    smoothing.current.set(car.id, sm)
    const fan = Math.max(0, 1 - model.wrap(distance - slot.distance) / 150)
    return { car, kind: 'track', distance: model.wrap(sm.shown), dim: false, lateral: slot.lateral * fan }
  }

  // Each car's own garage in the pit lane, so cars don't shuffle along it as others come and go: the round's official
  // order where we have it (teams.ts), else by car number. Back of the field first, so slots by the line (tracks
  // without a pit lane) are handed out in a stable order.
  const garageOrder = isF1 ? undefined : teamsRoundFor(timing.session.meeting)?.garages
  const garages = useMemo(() => garageSpots(model, mapCars, garageOrder), [model, mapCars.map((c) => c.id).join(), garageOrder]) // eslint-disable-line react-hooks/exhaustive-deps -- the ids are the key
  const garageOf = (car: CarRow) => garages.get(car.id)
  const placements: Placement[] = []
  let pitIndex = 0
  let onTrack = 0
  let known = 0
  // Once a session has ended (not just the chequered flag: the cool-down lap still shows) nobody is on track. F1's
  // hub sends the last session's full state on connecting, days later; each car's last mini-sector then looked like
  // a crossing made just now, and the map raced the field round for ~10 s.
  const ended = timing.session.flag.trim().toLowerCase() === 'ended'
  for (const row of ended ? [] : [...mapCars].sort((a, b) => (b.position || 99) - (a.position || 99))) {
    // With a broadcast delay the live feed may already have a newer crossing than the delayed snapshot (the
    // snapshot only shows it a moment after it happened): estimate on from that one, or the car stepped back.
    const seen = live && !row.inPit ? crossings.current.latest(row.id, now) : undefined
    const crossed = seen && seen.at > row.lastPointAt ? { ...row, lastPoint: seen.point, lastPointAt: seen.at } : row
    const car = rejoined(crossed, now)
    if (shootout && car.inPit) continue
    // On the grid before the start, and launching from it until the car's first crossing of the race.
    const slot = race && !car.inPit ? slotOf(car) : undefined
    if (slot && preStart && onGrid(car, order, now)) {
      const distance = preStartDistance(model, car, order, slot, stretches[order.length - 1], now)
      const sm = smoothPosition(smoothing.current.get(car.id), car.lastPointAt, distance, now, model.length, TAU)
      smoothing.current.set(car.id, sm)
      placements.push({ car, kind: 'track', distance: model.wrap(sm.shown), dim: false, lateral: slot.lateral })
      continue
    }
    if (slot && started && now - green < LAUNCH_SECONDS && car.laps === 0 && car.lastPointAt < green) {
      const next = live ? crossings.current.firstAfter(car.id, green) : undefined
      const distance = launchDistance(model, slot, green, now, order, next, stretches, skipAfter)
      onTrack++
      if (next) known++
      placements.push(launched(car, slot, distance))
      continue
    }
    // A standing restart: on the grid until the lights go out, then launched until the first crossing past the line.
    const restartCar = !car.inPit ? restart?.cars.get(car.id) : undefined
    const latest = restartCar ? crossings.current.latest(car.id, now) : undefined
    const out = restart?.lightsOut
    if (restartCar && latest && (latest.at <= restartCar.stop.at || (latest.point === 'M' && out !== undefined && latest.at >= out))) {
      onTrack++
      if (out === undefined || now < out) {
        const arriving = { ...car, lastPoint: restartCar.stop.point, lastPointAt: restartCar.stop.at }
        // The track's flying time for the stretch: the session's reference is from laps behind the safety car here
        // (Monaco 2024: cars were still 230 m short of their slots at the lights).
        const distance = preStartDistance(model, arriving, order, restartCar.slot, stretches[order.length - 1], now)
        const sm = smoothPosition(smoothing.current.get(car.id), car.lastPointAt, distance, now, model.length, TAU)
        smoothing.current.set(car.id, sm)
        placements.push({ car, kind: 'track', distance: model.wrap(sm.shown), dim: false, lateral: restartCar.slot.lateral })
        continue
      }
      const next = crossings.current.firstAfter(car.id, out, true)
      if (next) known++
      placements.push(launched(car, restartCar.slot, launchDistance(model, restartCar.slot, out, now, order, next, stretches, skipAfter)))
      continue
    }
    const inLap = shootout && car.lapsSincePit >= 2
    // In-laps are slow: don't cap them at racing pace.
    const state = carPosition(car, model, order, fallback, now, inLap ? undefined : cap, baseline, caution, isF1 ? F1_PACING : SUPERCARS_PACING)
    if (inLap && state.kind === 'track' && (state.stale || (car.lastPoint === lastPointId && state.overdue))) continue
    if (state.kind === 'track') {
      // Known from the live feed (broadcast delay): where the car really was between two crossings.
      const exact = knownDistance(model, car, live ? crossings.current.around(car.id, now) : undefined, now)
      onTrack++
      if (exact !== undefined) known++
      // Just out of the pits: down the rest of the pit lane from its garage first, then on from the pit exit.
      const leaving = leavingPits(model, car, exact ?? state.distance, order, garageOf(car))
      if (leaving?.kind === 'pit') {
        smoothing.current.delete(car.id) // it joins the track at the exit, not from where it was before it pitted
        placements.push({ car, kind: 'pit', point: leaving.point, dim: false })
        continue
      }
      const distance = leaving?.distance ?? exact ?? state.distance
      const sm = smoothPosition(smoothing.current.get(car.id), car.lastPointAt, distance, now, model.length, caution ? TAU_CAUTION : TAU)
      smoothing.current.set(car.id, sm)
      placements.push({ car, kind: 'track', distance: model.wrap(sm.shown), dim: state.stale })
    } else if (state.kind === 'pit') {
      const garage = garageOf(car)
      const point = garage !== undefined ? model.pitPointAt(garage) : pitAreaSlot(model, pitIndex++)
      placements.push({ car, kind: 'pit', point, dim: true })
    }
  }

  // Synced as soon as positions are known rather than estimated (a replay, or live with a broadcast delay): no grey
  // map after a seek or a 2D/3D switch. markSynced keeps it synced for the session across view switches.
  const knownNow = onTrack > 0 && known >= onTrack * 0.9
  if (knownNow) sync.markSynced()
  return { now, model, effective, placements, sync: knownNow ? { ...sync, synced: true } : sync, awaitingCalibration, flagNow, caution: !!caution }
}

/**
 * A car that has left the pits since its last crossing, and whose last crossing was the line (Supercars: the pit lane
 * runs past it), starts its stretch at its pit-out time: from the line crossing made ~70 s earlier it looked long
 * overdue and waited just short of the next point until it crossed (measured on Race 30 with a 40 s broadcast delay:
 * every stall left on the map was a car leaving the pits; the stretch was over knownPosition's 60 s limit too).
 */
export function rejoined(car: CarRow, now: number): CarRow {
  const out = car.pitLog?.at(-1)?.outAt ?? 0
  if (car.inPit || car.lastPoint !== 'M' || out <= car.lastPointAt || out > now) return car
  return { ...car, lastPointAt: out }
}

/**
 * Where a car was at `now` when the crossings either side are known (`around`, from the crossing log: a broadcast
 * delay, or a replay's lookahead), else undefined. A car just out of the pits (rejoined) runs from the pit exit to its
 * next point from its pit-out time: from the line it had too far to go and ran at 120+ m/s for a second (rebuilt 2025
 * Gold Coast Race 28, every frame over 100 m/s with a 90 s lookahead). Shared with tools/MapDelaySim.
 */
export function knownDistance(model: TrackModel, car: CarRow, around: [Crossing, Crossing] | undefined, now: number): number | undefined {
  if (!around) return undefined
  const [a, b] = around
  if (car.lastPoint === a.point && car.lastPointAt > a.at && car.lastPointAt === car.pitLog?.at(-1)?.outAt) {
    return knownPosition(model, { point: car.lastPoint, at: car.lastPointAt }, b, now)
  }
  return knownPosition(model, a, b, now)
}

/**
 * Garage spots: metres along the pit lane for each car, spread over its middle part. With `order` (car numbers by
 * garage, garage 1 nearest pit exit: the teams' championship leaders, teams.ts) garage 1 is the spot nearest the exit
 * and cars not in it follow the listed ones; without it, by car number from the entry. Empty without a pit lane.
 */
export function garageSpots(model: TrackModel, cars: CarRow[], order?: string[]): Map<string, number> {
  const pit = model.pitLane
  if (!pit) return new Map()
  const byNumber = (x: CarRow, y: CarRow) => (parseInt(x.carNumber, 10) || 0) - (parseInt(y.carNumber, 10) || 0) || x.carNumber.localeCompare(y.carNumber)
  const garage = (c: CarRow) => { const i = order?.indexOf(c.carNumber) ?? -1; return i < 0 ? Infinity : i }
  const sorted = [...cars].sort((x, y) => garage(x) - garage(y) || byNumber(x, y))
  const share = (i: number) => (i + 0.5) / sorted.length
  return new Map(sorted.map((c, i) => [c.id, pit.length * (order ? GARAGES_TO - (GARAGES_TO - GARAGES_FROM) * share(i) : GARAGES_FROM + (GARAGES_TO - GARAGES_FROM) * share(i))]))
}

/**
 * Where a car just out of the pits is drawn when its pit lane rejoins the lap partway along the stretch it's on (the
 * Gold Coast: Natsoft's pit-out comes from the pit lane, the lane runs past the line and rejoins 295 m on; Bathurst's
 * rejoins just before the first point). `distance` is where the timing puts it on that stretch, as if it had started
 * from the line. The stretch's simulated time up to the pit exit is spent driving from its garage to the end of the
 * pit lane, the rest on track from the exit, so it still reaches the next point when the timing says. Before, it
 * appeared on track at the line and raced alongside the pit lane. Undefined when that doesn't apply (no pit lane, not
 * just out of the pits, or the lane rejoins on another stretch). Shared with tools/MapDelaySim.
 */
export function leavingPits(
  model: TrackModel, car: CarRow, distance: number, order: string[], garage: number | undefined,
): { kind: 'pit'; point: Vec } | { kind: 'track'; distance: number } | undefined {
  const pit = model.pitLane
  if (!pit || car.inPit || car.lastPointAt <= 0 || car.lastPointAt !== car.pitLog?.at(-1)?.outAt) return undefined
  const i = order.indexOf(car.lastPoint)
  const from = model.pointDistance.get(car.lastPoint)
  const to = i < 0 ? undefined : model.pointDistance.get(order[(i + 1) % order.length])
  if (from === undefined || to === undefined) return undefined
  const span = model.wrap(to - from) || model.length
  if (model.wrap(pit.exit - from) >= span) return undefined
  // Simulated seconds from `from` forward to `d`, on this stretch.
  const sim = (d: number) => {
    const end = from + model.wrap(d - from)
    return end > model.length ? model.lapSimTime - model.simTimeAt(from) + model.simTimeAt(end - model.length) : model.simTimeAt(end) - model.simTimeAt(from)
  }
  const total = sim(to) || 1
  const inLane = sim(pit.exit) / total // share of the stretch spent in the pit lane
  const f = sim(distance) / total
  // Already past the next point: the feed skipped it (F1 often doesn't send Austin's first mini-sector on an out-lap,
  // 20 m after the pit exit), so the timing's own distance is right. Clamping it held cars at 1.1 for ~3 s.
  if (f >= 1) return { kind: 'track', distance }
  if (f < inLane) {
    const start = garage ?? pit.length / 2
    return { kind: 'pit', point: model.pitPointAt(start + (pit.length - start) * (f / inLane)) }
  }
  return { kind: 'track', distance: placeBetween(model, pit.exit, to, (f - inLane) / (1 - inLane || 1)) }
}

/** For tracks without a mapped pit lane: a row beside the control line. */
function pitAreaSlot(model: TrackModel, index: number): Vec {
  const n = model.normalAt(0)
  const offset = (Math.ceil(index / 2) * PIT_SPACING * (index % 2 ? 1 : -1))
  const p = model.pointAt(offset)
  return { x: p.x + n.x * 110, y: p.y + n.y * 110 }
}

