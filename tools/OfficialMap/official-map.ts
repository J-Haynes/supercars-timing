/**
 * Lines up an official Supercars track map (the event's "getting around" PDF) with our track file, and writes the
 * race-relevant things on it (pit lane, numbered corners) in latitude/longitude for TrackBuilder:
 * tools/TrackBuilder/official/<CODE>.json. See tools/OfficialMap/README.md.
 *
 *   cd src/web && npx tsx ../../tools/OfficialMap/official-map.ts <map.pdf> <CODE> <corners.json>
 *
 * corners.json: { "source": "<url of the PDF>", "corners": [{ "name": "T4 Pizza Hut Hairpin", "at": [x, y] }] }, where
 * [x, y] is the centre of the corner's marker in PDF points (the script prints the round markers it finds to help).
 *
 * How: pdftocairo turns the PDF into SVG. These maps draw the track and the pit lane as a dark stroke on top of a
 * wider white one (the white shows as edge lines), so the longest such pair is the track and the next is the pit lane.
 * The track is fitted to our centreline with a similarity transform (rotation, one scale, shift; PDF y flipped), by a
 * rotation sweep and iterative closest point. The maps say "not to scale", so the fit is checked: it refuses when the
 * official track is on average more than 15 m from ours.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type P = [number, number]
const [pdfFile, code, cornersFile] = process.argv.slice(2)
if (!pdfFile || !code) {
  console.log('usage: npx tsx tools/OfficialMap/official-map.ts <map.pdf> <CODE> [corners.json]')
  process.exit(1)
}
const root = resolve(import.meta.dirname, '../..')
const track = JSON.parse(readFileSync(join(root, `src/web/src/tracks/${code}.json`), 'utf8'))
if (!track.origin) throw new Error(`${code}.json has no origin: rebuild it with TrackBuilder first`)

// --- SVG paths ---------------------------------------------------------------------------------------------------
const svgFile = join(mkdtempSync(join(tmpdir(), 'official-map-')), 'map.svg')
execFileSync('pdftocairo', ['-svg', pdfFile, svgFile])
const svg = readFileSync(svgFile, 'utf8')

interface SvgPath { lines: P[][]; stroke: number[] | null; fill: number[] | null; width: number }
const NUM = /-?\d*\.?\d+(?:e-?\d+)?/g
function parsePath(attrs: string): SvgPath {
  const m = /transform="matrix\(([^)]*)\)"/.exec(attrs)
  const t = m ? m[1].trim().split(/[ ,]+/).map(Number) : [1, 0, 0, 1, 0, 0]
  const ap = ([x, y]: P): P => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]
  const d = / d="([^"]*)"/.exec(attrs)?.[1] ?? ''
  const tokens = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  const lines: P[][] = []
  let cur: P[] = [], cmd = '', pos: P = [0, 0], start: P = [0, 0]
  for (let i = 0; i < tokens.length;) {
    if (/[MLCZmlcz]/.test(tokens[i])) cmd = tokens[i++]
    if (cmd === 'Z' || cmd === 'z') { cur.push(ap(start)); lines.push(cur); cur = []; pos = start; continue }
    const n = cmd === 'C' ? 6 : 2
    const v = tokens.slice(i, i + n).map(Number)
    i += n
    if (v.length < n) break
    if (cmd === 'M') { if (cur.length) lines.push(cur); pos = start = [v[0], v[1]]; cur = [ap(pos)]; cmd = 'L' }
    else if (cmd === 'L') { pos = [v[0], v[1]]; cur.push(ap(pos)) }
    else if (cmd === 'C') {
      // Cubic Bezier, sampled in 20 steps.
      const [p0, p1, p2, p3]: P[] = [pos, [v[0], v[1]], [v[2], v[3]], [v[4], v[5]]]
      for (let k = 1; k <= 20; k++) {
        const s = k / 20, a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, c = 3 * (1 - s) * s * s, e = s ** 3
        cur.push(ap([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]))
      }
      pos = p3
    }
  }
  if (cur.length) lines.push(cur)
  const colour = (key: string) => {
    const c = new RegExp(`${key}="rgb\\(([\\d.]+)%,\\s*([\\d.]+)%,\\s*([\\d.]+)%\\)"`).exec(attrs)
    return c ? c.slice(1).map(Number) : null
  }
  return { lines, stroke: colour('stroke'), fill: colour('fill'), width: Number(/stroke-width="([\d.]+)"/.exec(attrs)?.[1] ?? 0) }
}
const paths = [...svg.matchAll(/<path ([^>]*)\/>/g)].map((m) => parsePath(m[1]))
const length = (line: P[]) => line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0)
const longest = (p: SvgPath) => p.lines.reduce((a, b) => (length(b) > length(a) ? b : a), [] as P[])
const dark = (c: number[] | null) => !!c && c[0] + c[1] + c[2] < 60
const white = (c: number[] | null) => !!c && c.every((v) => v > 95)
// A dark stroke with a wider white stroke of the same shape somewhere beneath it (the white ones are drawn first).
const whites = paths.filter((p) => white(p.stroke) && p.width >= 5).map((p) => ({ p, len: length(longest(p)) }))
const roads = paths
  .map((p, i) => ({ p, i, len: length(longest(p)) }))
  .filter(({ p, len }) => dark(p.stroke) && p.width >= 5 && whites.some((w) => w.p.width > p.width && Math.abs(w.len - len) < 1))
  .sort((a, b) => b.len - a.len)
if (roads.length < 1) throw new Error('No track found (a dark stroke over a wider white one)')
const officialTrack = longest(roads[0].p).map(([x, y]): P => [x, -y])
const officialPit = roads[1] ? longest(roads[1].p).map(([x, y]): P => [x, -y]) : null
console.log(`Track: path #${roads[0].i}, ${length(officialTrack).toFixed(0)} PDF units; pit lane: ${roads[1] ? `path #${roads[1].i}, ${length(officialPit!).toFixed(0)} units` : 'none found'}`)

// Round corner markers: white-filled circles 15-25 units across, listed to help write corners.json.
const markers = paths.filter((p) => white(p.fill) && p.lines.length > 0).map((p) => {
  const pts = p.lines.flat(), xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys)
  return { w, h, at: [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2] as P }
}).filter((m) => m.w > 15 && m.w < 25 && Math.abs(m.w - m.h) < 1)

// --- Fit -----------------------------------------------------------------------------------------------------------
function resample(p: P[], step: number): P[] {
  const out: P[] = [p[0]]
  let carry = 0
  for (let i = 1; i < p.length; i++) {
    const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
    for (let d = step - carry; d <= seg; d += step) {
      const f = d / seg
      out.push([p[i - 1][0] + f * (p[i][0] - p[i - 1][0]), p[i - 1][1] + f * (p[i][1] - p[i - 1][1])])
    }
    carry = (carry + seg) % step
  }
  return out
}
const nearest = (q: P, set: P[]) => {
  let best = Infinity, at = 0
  for (let i = 0; i < set.length; i++) { const d = (set[i][0] - q[0]) ** 2 + (set[i][1] - q[1]) ** 2; if (d < best) { best = d; at = i } }
  return { at, dist: Math.sqrt(best) }
}
/** z -> a*z + b, a and b complex: rotation and uniform scale, then a shift. */
type T = { ar: number; ai: number; br: number; bi: number }
const apply = (t: T, [x, y]: P): P => [t.ar * x - t.ai * y + t.br, t.ai * x + t.ar * y + t.bi]
const mean = (ps: P[]): P => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length]
/** Least squares: a = sum((w - w̄) conj(z - z̄)) / sum|z - z̄|², b = w̄ - a z̄. */
function solve(src: P[], dst: P[]): T {
  const [zx, zy] = mean(src), [wx, wy] = mean(dst)
  let nr = 0, ni = 0, den = 0
  src.forEach(([x0, y0], i) => {
    const x = x0 - zx, y = y0 - zy, u = dst[i][0] - wx, v = dst[i][1] - wy
    nr += u * x + v * y; ni += v * x - u * y; den += x * x + y * y
  })
  const ar = nr / den, ai = ni / den
  return { ar, ai, br: wx - (ar * zx - ai * zy), bi: wy - (ai * zx + ar * zy) }
}
const ours: P[] = resample(track.path, 5)
const src = resample(officialTrack, 4)
const scale0 = track.length / length(officialTrack)
let best: { t: T; err: number } | null = null
for (let deg = 0; deg < 360; deg += 3) {
  const r = (deg * Math.PI) / 180, [sx, sy] = mean(src), [ox, oy] = mean(ours)
  const ar = scale0 * Math.cos(r), ai = scale0 * Math.sin(r)
  let t: T = { ar, ai, br: ox - (ar * sx - ai * sy), bi: oy - (ai * sx + ar * sy) }
  for (let k = 0; k < 20; k++) t = solve(src, src.map((p) => ours[nearest(apply(t, p), ours).at]))
  const err = src.reduce((s, p) => s + nearest(apply(t, p), ours).dist, 0) / src.length
  if (!best || err < best.err) best = { t, err }
}
const t = best!.t
const dists = resample(officialTrack, 1).map((p) => nearest(apply(t, p), ours).dist).sort((a, b) => a - b)
const fit = {
  meanMetres: +(dists.reduce((a, b) => a + b, 0) / dists.length).toFixed(1),
  maxMetres: +dists[dists.length - 1].toFixed(1),
  officialLapMetres: Math.round(length(officialTrack) * Math.hypot(t.ar, t.ai)),
  ourLapMetres: Math.round(track.length),
  rotationDegrees: +((Math.atan2(t.ai, t.ar) * 180) / Math.PI).toFixed(1),
}
console.log(`Fit: official track ${fit.meanMetres} m from ours on average (max ${fit.maxMetres} m); lap ${fit.officialLapMetres} m vs ${fit.ourLapMetres} m; rotated ${fit.rotationDegrees}°`)
if (fit.meanMetres > 15) throw new Error('The official map does not line up with our track (mean > 15 m): not to scale, or the wrong track')

// --- Output in latitude/longitude ----------------------------------------------------------------------------------
const [lat0, lon0] = track.origin as P
const R = 6_371_000, cosLat = Math.cos((lat0 * Math.PI) / 180)
/** PDF point (y down) -> [lat, lon], via our track's metres (the inverse of TrackBuilder's Projection). */
const toLatLon = ([x, y]: P): P => {
  const [mx, my] = apply(t, [x, -y])
  return [+(lat0 + (my / R) * (180 / Math.PI)).toFixed(7), +(lon0 + (mx / (R * cosLat)) * (180 / Math.PI)).toFixed(7)]
}
const metres = ([x, y]: P) => apply(t, [x, -y])
const along = (p: P) => nearest(metres(p), ours).at * 5

console.log(`\nRound markers on the map (PDF points), nearest point of our lap:`)
for (const m of markers.sort((a, b) => along(a.at) - along(b.at)))
  console.log(`  [${m.at[0].toFixed(1)}, ${m.at[1].toFixed(1)}]  ${along(m.at).toFixed(0)} m into our lap, ${nearest(metres(m.at), ours).dist.toFixed(0)} m off it`)

if (!cornersFile) { console.log('\nNo corners.json given: nothing written.'); process.exit(0) }
const input = JSON.parse(readFileSync(cornersFile, 'utf8')) as { source: string; corners: { name: string; at: P }[] }
const corners = input.corners.map((c) => ({ name: c.name, at: toLatLon(c.at), alongMetres: Math.round(along(c.at)) }))
console.log('\nCorners (distance into our lap):')
for (const c of corners) console.log(`  ${c.alongMetres.toString().padStart(5)} m  ${c.name}`)
const out = {
  source: input.source,
  note: 'Written by tools/OfficialMap/official-map.ts from the official track map; read by TrackBuilder --official.',
  fit,
  corners: corners.map(({ name, at }) => ({ name, at })),
  // Back to PDF points (y down) for toLatLon.
  pitLane: officialPit ? resample(officialPit.map(([x, y]): P => [x, -y]), 4).map(toLatLon) : [],
}
const outFile = join(root, `tools/TrackBuilder/official/${code}.json`)
writeFileSync(outFile, JSON.stringify(out, null, 1) + '\n')
console.log(`\nWrote ${outFile.replace(root + '/', '')}`)
