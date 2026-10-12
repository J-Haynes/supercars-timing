/**
 * Backtest of the pit rejoin estimate (src/web/src/pit) on a recorded Supercars race: for every real pit stop, predict
 * the rejoin from the moment before the car entered the pit lane (with only the stops made before then), and compare
 * with where it really was 20 s after leaving the pits. Uses the running server's replay API (recordings only; it
 * never contacts Natsoft).
 *
 *   cd src/web && npx tsx ../../tools/PitLoss/backtest.mts V8SUPER_20261011_094535-2510 MOUN [http://localhost:5080] [60]
 *
 * F1 (no replay API): save the test server's /api/f1/snapshot every 0.25 s while it replays an archived race, one JSON
 * snapshot per line, then pass the file instead of a session id:
 *
 *   cd src/web && npx tsx ../../tools/PitLoss/backtest.mts f1:<snapshots.jsonl> F1-61
 *
 * Three loss models, so errors in the loss and in the rejoin maths can be told apart:
 *   model   - what the app shows (last year / this race's stops so far, pitLoss.ts)
 *   prior   - last year's figures only
 *   actual  - the stop's own real cost (PT - 2.7 s): what's left is the rejoin maths and other cars' stops
 */
const [session, trackCode, server = "http://localhost:5080", afterText = "60"] = process.argv.slice(2)
const f1File = session.startsWith('f1:') ? session.slice(3) : null
// series.ts reads the page's URL to know which app it is.
;(globalThis as { window?: unknown }).window = { location: { pathname: f1File ? '/f1' : '/' } }
const AFTER = Number(afterText) // seconds after leaving the pits to check where the car really is
const { estimateLoss, measuredStops } = await import('../../src/web/src/pit/pitLoss.ts')
const { predictRejoin, progress, progressModel } = await import('../../src/web/src/pit/rejoin.ts')
const { flagKind } = await import('../../src/web/src/session.ts')
type Snapshot = import('../../src/web/src/types.ts').TimingSnapshot
type CarRow = import('../../src/web/src/types.ts').CarRow
const track = (await import(`../../src/web/src/tracks/${trackCode}.json`, { with: { type: 'json' } })).default

const get = async (path: string) => (await fetch(server + path)).json()
// F1: snapshots saved from a replay, in time order. The snapshot just before (or just after) a time stands in for the
// replay API.
const saved: Snapshot[] = f1File ? (await import('node:fs')).readFileSync(f1File, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []
const final: Snapshot = f1File ? saved[saved.length - 1] : await get(`/api/sessions/${session}/results`)
const laps = final.session.scheduledLaps
const fallback = ['M', ...final.timingPoints.map((p) => p.id)].map((id) => track.segmentSeconds.find((s: { from: string }) => s.from === id)?.seconds || 0)

const stops = final.cars.flatMap((car) => car.pitLog.map((stop, i) => ({ car: car.id, number: car.carNumber, stopNumber: i + 1, ...stop })))
  .filter((s) => s.outAt > 0 && s.seconds < 200)
  .sort((a, b) => a.inAt - b.inAt)

const snap = async (t: number, viewer: string): Promise<Snapshot> => {
  if (!f1File) return get(`/api/sessions/${session}/replay?t=${t}&viewer=${viewer}`)
  // Before a stop: the last snapshot at or before t. After: the first at or after t.
  return viewer === 'bt-before' ? [...saved].reverse().find((x) => x.now <= t) ?? saved[0] : saved.find((x) => x.now >= t) ?? saved[saved.length - 1]
}
const { pitLaneOffset } = await import('../../src/web/src/pit/pitLoss.ts')

type Row = { model: string; posError: number; inRange: boolean; gapError: number | null; lossIn: boolean; clean: boolean }
const rows: Row[] = []
let skipped = 0
for (const stop of stops) {
  const before = await snap(stop.inAt - 1, 'bt-before')
  const after = await snap(stop.outAt + AFTER, 'bt-after')
  if (flagKind(before.session.flag) !== 'green' || flagKind(after.session.flag) !== 'green') { skipped++; continue }
  const car = before.cars.find((c) => c.id === stop.car)!
  const carAfter = after.cars.find((c) => c.id === stop.car)!
  const m = progressModel(before, fallback)
  if (!m || car.inPit || carAfter.inPit) { skipped++; continue }
  const measured = measuredStops(before, trackCode)
  const lossOf = (c: CarRow) => estimateLoss(c.pitLog.length, trackCode, measured, laps).range[1]
  const lossAfter = (c: CarRow) => estimateLoss(c.pitLog.length, trackCode, measuredStops(after, trackCode), laps).range[1]
  // What really happened: race position from progress 20 s after the stop.
  const mine = progress(carAfter, m, after.now, lossAfter)!
  const others = after.cars.filter((c) => c.id !== stop.car).map((c) => ({ c, p: progress(c, m, after.now, lossAfter) }))
  const actualPosition = 1 + others.filter((o) => o.p !== null && o.p > mine).length
  const actualLoss = stop.seconds - pitLaneOffset(trackCode)
  // Did any other car stop between the prediction and the check? Then positions change for reasons the ghost can't know.
  const clean = !stops.some((o) => o.car !== stop.car && o.inAt < stop.outAt + AFTER && o.outAt > stop.inAt - 1)
  const models: [string, [number, number, number]][] = [
    ['model', estimateLoss(stop.stopNumber, trackCode, measured, laps).range],
    ['prior', estimateLoss(stop.stopNumber, trackCode, [], laps).range],
    ['actual', [actualLoss, actualLoss, actualLoss]],
  ]
  for (const [name, range] of models) {
    const r = predictRejoin(before, car, range, m, before.now, lossOf)
    if (!r) continue
    // Gap to the car predicted just ahead on the road, if it didn't stop in between.
    let gapError: number | null = null
    const j = r.ahead?.car
    const jAfter = j && after.cars.find((c) => c.id === j.id)
    if (j && jAfter && jAfter.pitLog.length === j.pitLog.length && !jAfter.inPit && r.ahead!.lapsApart === 0) {
      const pj = progress(jAfter, m, after.now, lossAfter)
      if (pj !== null) gapError = r.ahead!.gap - (pj - mine)
    }
    rows.push({ model: name, posError: r.position - actualPosition, inRange: actualPosition >= r.best && actualPosition <= r.worst,
      gapError, lossIn: actualLoss >= range[0] && actualLoss <= range[2], clean })
  }
}

const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(1, d))}%`
const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
console.log(`${session} (${trackCode}): ${stops.length} stops, ${skipped} skipped (caution, in the pits)`)
for (const [name, cleanOnly] of [['model', false], ['prior', false], ['actual', false], ['model', true], ['actual', true]] as const) {
  const r = rows.filter((x) => x.model === name && (!cleanOnly || x.clean))
  const gaps = r.map((x) => x.gapError).filter((g): g is number => g !== null)
  console.log(`  ${(name + (cleanOnly ? ' (no other stops)' : '')).padEnd(24)} n=${r.length}  position exact ${pct(r.filter((x) => x.posError === 0).length, r.length)}, ` +
    `within 1 ${pct(r.filter((x) => Math.abs(x.posError) <= 1).length, r.length)}, in predicted range ${pct(r.filter((x) => x.inRange).length, r.length)}, ` +
    `mean error ${(r.reduce((a, x) => a + x.posError, 0) / Math.max(1, r.length)).toFixed(2)} | gap to car ahead: median abs error ` +
    `${med(gaps.map(Math.abs)).toFixed(1)} s, median ${med(gaps).toFixed(1)} s (n=${gaps.length}) | real loss inside range ${pct(r.filter((x) => x.lossIn).length, r.length)}`)
}
