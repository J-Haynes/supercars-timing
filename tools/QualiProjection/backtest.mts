/**
 * Backtest of the qualifying lap projection (src/web/src/qualiProjection.ts) on a recorded practice, qualifying or
 * Shootout session. It steps through the session with the running server's replay API (recordings only; it never
 * contacts Natsoft), projects every car on a timed lap at each timing point, and compares with the lap time the car
 * then did. Run it on the laptop, where the recordings are:
 *
 *   cd src/web && npx tsx ../../tools/QualiProjection/backtest.mts <session id> [server] [step seconds] [--f1]
 *   cd src/web && npx tsx ../../tools/QualiProjection/backtest.mts V8SUPER_20261010_011500-2210 http://localhost:5080 2
 *
 * Session ids are in GET /api/sessions (Supercars) or /api/f1/sessions (with --f1). Each step fetches one replay
 * snapshot (viewer "qp-backtest"), so a 40-minute session at 2 s is ~1,200 requests to localhost.
 *
 * It reports:
 *   1. Projection error (projected minus actual lap time) by how far round the lap the car was, for laps the projection
 *      called pushing that ended as push laps: bias, median and 90th percentile of the absolute error, per basis.
 *   2. Push-lap detection: how well "pushing" (at the second point, and at half distance) picks the laps that ended
 *      within 1 % of the car's best lap of the session, for a range of maxDelta thresholds.
 *   3. How often push laps beat the optimistic figure (the car's best stretches so far): not a floor, since drivers
 *      improve through a session, but if it's beaten often it isn't worth showing as "at best".
 */
const args = process.argv.slice(2)
const f1 = args.includes('--f1')
const [session, server = 'http://localhost:5080', stepText = '2'] = args.filter((a) => a !== '--f1')
if (!session) { console.error('Usage: backtest.mts <session id> [server] [step seconds] [--f1]'); process.exit(1) }
// series.ts reads the page's URL to know which app it is.
;(globalThis as { window?: unknown }).window = { location: { pathname: f1 ? '/f1' : '/' } }
const { projectLaps, PROJECTION_TUNING } = await import('../../src/web/src/qualiProjection.ts')
const { flagKind, isRace } = await import('../../src/web/src/session.ts')
type Snapshot = import('../../src/web/src/types.ts').TimingSnapshot
type LapProjection = import('../../src/web/src/qualiProjection.ts').LapProjection

const api = f1 ? '/api/f1' : '/api'
const get = async (path: string) => {
  const res = await fetch(server + path)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}
const info: { start: number; end: number } = await get(`${api}/sessions/${session}/replay/info`)
const final: Snapshot = await get(`${api}/sessions/${session}/results`)
if (isRace(final.session.type)) console.warn(`Note: ${final.session.name} is a race; the projection is meant for practice and qualifying.`)
const step = Number(stepText)

// A lap is keyed by car and its start time. Every projection made during it (one per point, the first time it's seen,
// with every threshold's "pushing" worked out from the delta), then the lap time it ended with.
interface Lap { car: string; start: number; lapsSincePit: number; preds: Map<number, LapProjection & { reference: number | null }>; actual?: number; spoiled?: boolean }
const laps = new Map<string, Lap>()
const open = new Map<string, Lap>() // car id -> lap in progress
// Thresholds to sweep: a looser tuning collects every projection; "pushing" is decided afterwards per threshold.
const loose = { ...PROJECTION_TUNING, maxDelta: Infinity, maxDeltaFirstLap: Infinity }

let snapshots = 0
for (let t = info.start; t <= info.end; t += step) {
  const snap: Snapshot = await get(`${api}/sessions/${session}/replay?t=${t}&viewer=qp-backtest`)
  snapshots++
  const green = flagKind(snap.session.flag) === 'green'
  const projections = projectLaps(snap, loose)
  for (const car of snap.cars) {
    const current = open.get(car.id)
    // The lap in progress ended: crossed the line (a new lap start) or went into the pits.
    if (current && car.lapStartAt !== current.start) {
      if (car.lapStartAt > current.start && car.lastLap > 0) current.actual = car.lastLap
      open.delete(car.id)
    }
    const p = projections.get(car.id)
    if (!p) continue
    const key = `${car.id}|${car.lapStartAt}`
    let lap = laps.get(key)
    if (!lap) {
      lap = { car: car.id, start: car.lapStartAt, lapsSincePit: car.lapsSincePit, preds: new Map() }
      laps.set(key, lap)
    }
    open.set(car.id, lap)
    // A caution or red flag during the lap spoils it for this purpose.
    if (!green) lap.spoiled = true
    if (!lap.preds.has(p.point)) {
      const best = car.bestLapSplits?.[p.point] ?? 0
      const own = (car.bestSegments ?? []).slice(0, p.point + 1)
      const reference = best > 0 ? best : own.length === p.point + 1 && own.every((x) => x > 0) ? own.reduce((a, b) => a + b, 0) : null
      lap.preds.set(p.point, { ...p, reference })
    }
  }
}

// Each car's best lap of the session (the final classification): a "push lap" ended within 1 % of it.
const bestOf = new Map(final.cars.map((c) => [c.id, c.bestLap]))
const done = [...laps.values()].filter((l) => l.actual && !l.spoiled)
const isPush = (l: Lap) => { const b = bestOf.get(l.car) ?? 0; return b > 0 && l.actual! <= b * 1.01 }
const pushLaps = done.filter(isPush)
const points = final.timingPoints.length + 1 // splits per lap, the line last

console.log(`${final.session.meeting} · ${final.session.name}`)
console.log(`${snapshots} snapshots every ${step} s · ${laps.size} timed laps seen · ${done.length} completed under green · ${pushLaps.length} push laps (within 1 % of the car's best)\n`)

const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN }
const f = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '   -  ')
const limitFor = (l: Lap, maxDelta: number, first: number) => (l.lapsSincePit === 1 ? first : maxDelta)
const pushingAt = (l: Lap, k: number, maxDelta = PROJECTION_TUNING.maxDelta, first = PROJECTION_TUNING.maxDeltaFirstLap) => {
  const p = l.preds.get(k)
  if (!p || p.pointsReached < PROJECTION_TUNING.minPoints) return false
  return p.reference === null || p.elapsed - p.reference <= limitFor(l, maxDelta, first)
}

// 1. Error by point, push laps the projection called pushing at that point.
console.log('1. Projection error on push laps (s): projected minus actual')
console.log('   point   laps   bias    |err| median   |err| p90    basis (best-lap / best-stretches / field)')
for (let k = 0; k < points - 1; k++) {
  const rows = pushLaps.filter((l) => pushingAt(l, k)).map((l) => ({ p: l.preds.get(k)!, err: l.preds.get(k)!.projected - l.actual! }))
  if (rows.length === 0) { console.log(`   ${String(k + 1).padStart(5)}      0${k + 1 < PROJECTION_TUNING.minPoints ? '   (not judged before point ' + PROJECTION_TUNING.minPoints + ')' : ''}`); continue }
  const errs = rows.map((r) => r.err)
  const basis = ['best-lap', 'best-stretches', 'field'].map((b) => rows.filter((r) => r.p.basis === b).length).join(' / ')
  console.log(`   ${String(k + 1).padStart(5)}  ${String(rows.length).padStart(5)}  ${f(errs.reduce((a, b) => a + b, 0) / errs.length).padStart(6)}  ${f(pct(errs.map(Math.abs), 0.5)).padStart(12)}  ${f(pct(errs.map(Math.abs), 0.9)).padStart(10)}    ${basis}`)
}

// 2. Detection: decided at the second point and at half distance, against "ended as a push lap".
console.log('\n2. Push-lap detection (precision = called pushing and was; recall = push laps called pushing)')
console.log('   maxDelta   first lap    at point 2: precision  recall    at half lap: precision  recall')
const half = Math.floor((points - 1) / 2)
for (const maxDelta of [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0]) {
  const first = maxDelta + 0.5
  const score = (k: number) => {
    const judged = done.filter((l) => l.preds.has(k))
    const called = judged.filter((l) => pushingAt(l, k, maxDelta, first))
    const hits = called.filter(isPush).length
    const push = judged.filter(isPush).length
    return [called.length ? hits / called.length : NaN, push ? hits / push : NaN]
  }
  const [p2, r2] = score(1)
  const [ph, rh] = score(half)
  const mark = maxDelta === PROJECTION_TUNING.maxDelta ? ' (now)' : ''
  console.log(`   ${maxDelta.toFixed(2).padStart(8)}  ${first.toFixed(2).padStart(9)}    ${(p2 * 100).toFixed(0).padStart(18)} %  ${(r2 * 100).toFixed(0).padStart(4)} %    ${(ph * 100).toFixed(0).padStart(19)} %  ${(rh * 100).toFixed(0).padStart(4)} %${mark}`)
}

// 3. The optimistic figure should be a floor.
const optimistic = pushLaps.flatMap((l) => [...l.preds.values()].map((p) => l.actual! < p.optimistic - 0.0005))
console.log(`\n3. Push-lap projections beaten by the lap (optimistic figure too slow): ${optimistic.filter(Boolean).length} of ${optimistic.length}`)
