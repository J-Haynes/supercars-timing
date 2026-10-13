// Supercars map with a broadcast delay: how often the map guesses (vs knows) where a car is, and how often a dot jumps,
// goes backwards or stalls, at 0/5/20/40 s of delay. Live snapshots come from a test server's replay endpoint every
// 0.25 s; each delay's map sees the snapshot from `delay` seconds earlier and places cars like map/useCarPlacement.ts
// (same functions, 60 frames a second, a perfect session clock). F1 has tools/F1MapEval (scored against real positions).
//
// Run a replay-only server on :5081 (CLAUDE.md, "Commands"), then from src/web:
//   npx tsx ../../tools/MapDelaySim/delay-sim.mts <session id> <track code> <from natsoft time> <seconds> [label] [samples.json]
// Race 30, green running and stops:   V8SUPER_20261011_094535-2510 MOUN 1791721779 900
// Race 30, safety car and restart:    V8SUPER_20261011_094535-2510 MOUN 1791738700 1200
// Rebuilt 2025 Gold Coast Race 28, green: DELAYS=0,90 ... V8SUPER_20251025_051800_hist-r28-0 SURF 1761410080 900
// Findings (Oct 2026) are in docs/PLANNING.md, "Map with a broadcast delay".
(globalThis as any).window = { location: { pathname: '/' } }
const W = new URL('../../src/web/src', import.meta.url).pathname
const { TrackModel } = await import(`${W}/map/trackModel.ts`)
const { carPosition, cautionPace, SUPERCARS_PACING } = await import(`${W}/map/carPosition.ts`)
const { CrossingLog, knownPosition } = await import(`${W}/map/crossingLog.ts`)
const { smoothPosition, TAU, TAU_CAUTION } = await import(`${W}/map/smoothing.ts`)
const { cautionPeriods, flagKind } = await import(`${W}/session.ts`)
const { rejoined, knownDistance } = await import(`${W}/map/useCarPlacement.ts`)
const { calibrateTimingPoints } = await import(`${W}/map/calibrate.ts`)
const { readFileSync } = await import('node:fs')
const [session, code] = [process.argv[2], process.argv[3]]
const track = JSON.parse(readFileSync(`${W}/tracks/${code}.json`, 'utf8'))
// Provisional tracks (no timing points yet) are calibrated from the session's pace, as useCarPlacement does: once.
let model = track.provisional ? null : new TrackModel(track)
const base = `http://localhost:5081/api/sessions/${session}`
const [from, seconds] = [Number(process.argv[4]), Number(process.argv[5])]
// Delays to compare (s); a replay's lookahead (ReplayView, 90 s) behaves like a delay of that length.
const DELAYS = (process.env.DELAYS ?? '0,5,20,40').split(',').map(Number)
const STEP = 0.25
const WARMUP = 60 // seconds after "page load" before counting (the log starts empty)

const log = new CrossingLog()
const samples: any[] = []
const buffer: any[] = [] // live snapshots, oldest first
type Stat = { frames: number; known: number; fast: number; back: number; stall: number; byFlag: Record<string, { frames: number; known: number }>; why: Record<string, number> }
const stats = new Map<number, Stat>(DELAYS.map((d) => [d, { frames: 0, known: 0, fast: 0, back: 0, stall: 0, byFlag: {}, why: {} }]))
const smooth = new Map<number, Map<string, any>>(DELAYS.map((d) => [d, new Map()]))
const lastShown = new Map<number, Map<string, number>>(DELAYS.map((d) => [d, new Map()]))

for (let t = from; t <= from + seconds; t += STEP) {
  const timing = await (await fetch(`${base}/replay?t=${t}&viewer=delaysim`)).json()
  const live = { feed: { mode: 'Replay', state: 'live', detail: null, clockRate: 1 }, timing }
  log.add(live)
  buffer.push(timing)
  while (buffer.length > 2 && buffer[1].now <= t - Math.max(...DELAYS) - 1) buffer.shift()
  // 60 frames a second between fetches, like the page; speeds measured over each 0.25 s.
  for (let sub = 1; sub <= 15; sub++) {
  const last = sub === 15
  for (const d of DELAYS) {
    const now = t - STEP + sub * STEP / 15 - d
    let shown: any = null
    for (const b of buffer) if (b.now <= now + 1e-6) shown = b
    if (!shown) continue
    const order = ['M', ...shown.timingPoints.map((p: any) => p.id)]
    if (!model) {
      const names = Object.fromEntries(shown.timingPoints.map((p: any) => [p.id, p.name]))
      const points = calibrateTimingPoints(track, order, names, shown.segmentReference)
      if (!points) continue
      model = new TrackModel({ ...track, timingPoints: points })
    }
    const baseline = order.map((id: string) => track.segmentSeconds.find((s: any) => s.from === id)?.seconds || 0)
    const fallback = order.map((_: string, i: number) => shown.segmentReference?.[i] || baseline[i])
    const flag = flagKind(shown.session.flag)
    const open = cautionPeriods(shown.flagHistory).at(-1)
    const caution = flag === 'caution' && open && open.end === undefined ? cautionPace(shown.cars, order, baseline, open.start, shown.now) : undefined
    const st = stats.get(d)!
    for (const row of shown.cars) {
      if (row.retired) continue
      const seen = !row.inPit ? log.latest(row.id, now) : undefined
      const car = rejoined(seen && seen.at > row.lastPointAt ? { ...row, lastPoint: seen.point, lastPointAt: seen.at } : row, now)
      const state = carPosition(car, model, order, fallback, now, undefined, baseline, caution, SUPERCARS_PACING)
      if (state.kind !== 'track') { lastShown.get(d)!.delete(row.id); continue }
      const pair = log.around(car.id, now)
      const kp = knownDistance(model, car, pair, now)
      const distance = kp ?? state.distance
      const sm = smoothPosition(smooth.get(d)!.get(car.id), car.lastPointAt, distance, now, model.length, caution ? TAU_CAUTION : TAU)
      smooth.get(d)!.set(car.id, sm)
      if (!last) continue
      const prev = lastShown.get(d)!.get(car.id)
      lastShown.get(d)!.set(car.id, sm.shown)
      if (t - from < WARMUP || prev === undefined || (flag !== 'green' && flag !== 'caution')) continue
      let move = (sm.shown - prev) % model.length
      if (move > model.length / 2) move -= model.length
      if (move < -model.length / 2) move += model.length
      const speed = move / STEP
      st.frames++
      const f = (st.byFlag[flag] ??= { frames: 0, known: 0 })
      f.frames++
      if (kp !== undefined) { st.known++; f.known++ }
      else {
        const why = !pair ? (log.latest(car.id, now) && !log.around(car.id, now) ? 'next crossing not in yet' : 'no crossing pair') : pair[1].at - pair[0].at > 60 ? 'stretch > 60 s' : 'pair spans > half a lap / same point'
        st.why[why] = (st.why[why] ?? 0) + 1
      }
      if (d === DELAYS[DELAYS.length - 1] && (speed > 100 || (flag === 'green' && speed < 8))) samples.push({ t: Math.round(t), car: car.carNumber, kind: speed > 100 ? 'FAST' : 'stall', speed: Math.round(speed), at: Math.round(sm.shown), known: kp !== undefined, last: car.lastPoint, sinceCross: Math.round(now - car.lastPointAt), inPitLap: row.lapsSincePit, pitOut: (row.pitLog ?? []).at(-1)?.outAt ? Math.round(now - row.pitLog.at(-1).outAt) : null, pair: pair && [pair[0].point, Math.round(pair[0].at - now), pair[1].point, Math.round(pair[1].at - now)] })
      if (speed > 100) st.fast++
      if (speed < -2) st.back++
      if (flag === 'green' && speed < 8 && speed >= -2) st.stall++
    }
  }
  }
}
console.log(`window ${from} +${seconds}s (${process.argv[6] ?? ''}); car-frames after ${WARMUP}s warm-up`)
console.log('delay | frames | known % | >100 m/s % | backwards % | stalled (<8 m/s, green) % | guessed because…')
for (const d of DELAYS) {
  const s = stats.get(d)!
  const pc = (x: number) => (100 * x / Math.max(1, s.frames)).toFixed(2)
  console.log(`${String(d).padStart(4)}s | ${s.frames} | ${pc(s.known)} | ${pc(s.fast)} | ${pc(s.back)} | ${pc(s.stall)} | ${JSON.stringify(s.why)} ${JSON.stringify(Object.fromEntries(Object.entries(s.byFlag).map(([k, v]) => [k, (100 * v.known / v.frames).toFixed(1) + '% known'])))}`)
}

const { writeFileSync } = await import('node:fs')
writeFileSync(process.argv[7] ?? '/dev/null', JSON.stringify(samples))
