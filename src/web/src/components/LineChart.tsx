import { useId, useState, type PointerEvent } from 'react'

export interface Series {
  id: string
  label: string
  /** CSS colour (a categorical slot); text never uses it, only the line and its markers. */
  color: string
  /** x = lap; y = null leaves a gap in the line (pit laps, slow laps). */
  points: { x: number; y: number | null; marked?: boolean }[]
  dashed?: boolean
  /** Leave out of the tooltip and legend (e.g. a trend line). */
  decoration?: boolean
}

const W = 560
const H = 240
const PAD = { left: 46, right: 74, top: 12, bottom: 26 }

/**
 * Small SVG line chart: laps along x, one y scale. 2px lines, a faint grid, a crosshair with a tooltip on hover,
 * and labels at the end of each line (up to four series). `invertY` puts 0 at the top (gap to the leader).
 */
export function LineChart({ series, yFormat, axisFormat = yFormat, invertY = false, robustY = false, ariaLabel }: {
  series: Series[]
  /**
   * Scale y to the typical values (median ± 6 median absolute deviations, at least ±3) and let outliers run off the
   * plot. For the battle graph, where a pit cycle's minute-long jump (~15 % of laps) would squash the real gap flat.
   */
  robustY?: boolean
  /** Values in the tooltip. */
  yFormat: (v: number) => string
  /** Axis labels (shorter, if needed to fit). Defaults to yFormat. */
  axisFormat?: (v: number) => string
  invertY?: boolean
  ariaLabel: string
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)
  const clipId = `plot-${useId().replace(/:/g, '')}`
  const all = series.flatMap((s) => s.points.filter((p) => p.y !== null)) as { x: number; y: number }[]
  if (all.length < 2) return <div className="chart-empty">Not enough laps yet.</div>

  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 1)
  let y0 = Math.min(...ys), y1 = Math.max(...ys)
  if (robustY && ys.length >= 10) {
    const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
    const m = med(ys)
    const spread = Math.max(6 * med(ys.map((y) => Math.abs(y - m))), 3)
    y0 = Math.max(y0, m - spread); y1 = Math.min(y1, m + spread)
  }
  const pad = (y1 - y0) * 0.08 || 1
  y0 -= pad; y1 += pad
  const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0)) * (W - PAD.left - PAD.right)
  const sy = (y: number) => {
    const f = (y - y0) / (y1 - y0)
    return invertY ? PAD.top + f * (H - PAD.top - PAD.bottom) : H - PAD.bottom - f * (H - PAD.top - PAD.bottom)
  }
  const yTicks = ticks(y0, y1, 5)
  const xTicks = ticks(x0, x1, 6).filter((t) => Number.isInteger(t))

  // Line path with gaps where y is null.
  const path = (s: Series) => {
    let d = '', pen = false
    for (const p of [...s.points].sort((a, b) => a.x - b.x)) {
      if (p.y === null) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`
      pen = true
    }
    return d
  }
  const data = series.filter((s) => !s.decoration)
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const x = x0 + (((e.clientX - box.left) / box.width) * W - PAD.left) / (W - PAD.left - PAD.right) * (x1 - x0)
    setHoverX(Math.min(x1, Math.max(x0, Math.round(x))))
  }
  const at = hoverX === null ? [] : data
    .map((s) => ({ s, p: s.points.find((p) => p.x === hoverX && p.y !== null) }))
    .filter((v): v is { s: Series; p: { x: number; y: number; marked?: boolean } } => !!v.p)
    .sort((a, b) => (invertY ? a.p.y - b.p.y : b.p.y - a.p.y))

  return (
    <div className="line-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHoverX(null)}>
        <defs>
          <clipPath id={clipId}><rect x={PAD.left} y={PAD.top - 2} width={W - PAD.left - PAD.right} height={H - PAD.top - PAD.bottom + 4} /></clipPath>
        </defs>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} className="chart-grid" />
            <text x={PAD.left - 6} y={sy(t)} className="chart-axis" textAnchor="end" dominantBaseline="middle">{axisFormat(t)}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={H - 8} className="chart-axis" textAnchor="middle">{t}</text>
        ))}
        {series.map((s) => (
          <g key={s.id} clipPath={`url(#${clipId})`}>
            <path d={path(s)} fill="none" stroke={s.color} strokeWidth={s.decoration ? 1.5 : 2} strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinejoin="round" strokeLinecap="round" opacity={s.decoration ? 0.8 : 1} />
            {/* Pit laps: hollow markers, ringed with the surface so overlapping lines stay readable. */}
            {s.points.filter((p) => p.marked && p.y !== null).map((p) => (
              <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={4} fill="var(--panel)" stroke={s.color} strokeWidth={2} />
            ))}
          </g>
        ))}
        {/* Direct labels at line ends for 2-4 series; a single series is named by the chart title. */}
        {data.length >= 2 && data.length <= 4 && endLabels(data, sx, sy).map((l) => (
          <text key={l.id} x={W - PAD.right + 6} y={l.y} className="chart-label" dominantBaseline="middle">{l.label}</text>
        ))}
        {hoverX !== null && (
          <g>
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD.top} y2={H - PAD.bottom} className="chart-crosshair" />
            {at.map(({ s, p }) => <circle key={s.id} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--panel)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hoverX !== null && at.length > 0 && (
        <div className="chart-tooltip" style={{ left: `${(sx(hoverX) / W) * 100}%` }}>
          <div className="chart-tooltip-title">Lap {hoverX}</div>
          {at.map(({ s, p }) => (
            <div key={s.id}><span className="chart-swatch" style={{ background: s.color }} />{s.label} <strong>{yFormat(p.y)}</strong>{p.marked ? ' · pit' : ''}</div>
          ))}
        </div>
      )}
      {data.length > 1 && (
        <div className="chart-legend">
          {data.map((s) => <span key={s.id}><span className="chart-swatch" style={{ background: s.color }} />{s.label}</span>)}
        </div>
      )}
    </div>
  )
}

/** About `count` round tick values between a and b. */
function ticks(a: number, b: number, count: number): number[] {
  const step0 = (b - a) / count
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const out: number[] = []
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(Number(t.toFixed(6)))
  return out
}

/** End-of-line label positions, nudged apart so they don't overlap. */
function endLabels(series: Series[], sx: (x: number) => number, sy: (y: number) => number) {
  void sx
  const labels = series.map((s) => {
    const last = [...s.points].reverse().find((p) => p.y !== null)
    return last ? { id: s.id, label: s.label, y: sy(last.y!) } : null
  }).filter((l): l is { id: string; label: string; y: number } => !!l).sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 12)
  return labels
}
