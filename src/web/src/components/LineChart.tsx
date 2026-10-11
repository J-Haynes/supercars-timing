import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'

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

export type Domain = [number, number]

const PAD_BASE = { left: 50, right: 80, top: 12, bottom: 26 }

/**
 * SVG line chart: laps along x, one y scale. 2px lines, a faint grid, a crosshair with a tooltip on hover, a legend
 * and labels at the end of each line (2-4 series). `invertY` puts the smallest value at the top (gap to the leader,
 * position).
 *
 * Optional, for the large chart view: a fixed `xDomain`/`yDomain` (otherwise automatic), `onXDomain`/`onYDomain` to
 * make it zoomable (wheel zooms laps around the pointer, Shift+wheel zooms y, drag pans, double-click resets),
 * a bigger `width`/`height`, and `showPoints` to mark every lap when few enough are in view.
 */
export function LineChart({
  series, yFormat, axisFormat = yFormat, invertY = false, robustY = false, ariaLabel,
  width = 560, height = 240, xDomain, yDomain, onXDomain, onYDomain, showPoints = false, integerY = false, xMax,
}: {
  series: Series[]
  /** Values in the tooltip. */
  yFormat: (v: number) => string
  /** Axis labels (shorter, if needed to fit). Defaults to yFormat. */
  axisFormat?: (v: number) => string
  invertY?: boolean
  /**
   * Scale y to the typical values (median ± 6 median absolute deviations, at least ±3) and let outliers run off the
   * plot. For the battle graph, where a pit cycle's minute-long jump (~15 % of laps) would squash the real gap flat.
   */
  robustY?: boolean
  ariaLabel: string
  width?: number
  height?: number
  xDomain?: Domain | null
  yDomain?: Domain | null
  onXDomain?: (d: Domain | null) => void
  onYDomain?: (d: Domain | null) => void
  showPoints?: boolean
  /** Whole-number y ticks only (positions). */
  integerY?: boolean
  /** Extend the lap axis to this (the race distance, e.g. 161), so the chart shows how much race is left. */
  xMax?: number
}) {
  const W = width, H = height
  // Room on the right for end-of-line labels (shown for 2-4 series), sized to the longest one.
  const labelled = series.filter((s) => !s.decoration)
  const longest = Math.max(0, ...labelled.map((s) => s.label.length))
  const PAD = { ...PAD_BASE, right: labelled.length >= 2 && labelled.length <= 4 ? Math.max(40, Math.round(longest * 6.2) + 14) : 24 }
  const [hoverX, setHoverX] = useState<number | null>(null)
  const clipId = `plot-${useId().replace(/:/g, '')}`
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ startX: number; domain: Domain } | null>(null)

  const all = series.flatMap((s) => s.points.filter((p) => p.y !== null)) as { x: number; y: number }[]
  const xsAll = all.map((p) => p.x)
  const dataX: Domain = [Math.min(...xsAll), Math.max(...xsAll, Math.min(...xsAll) + 1, xMax ?? 0)]
  // A fixed domain can leave one end automatic (NaN), e.g. only "from" typed in the large view.
  const x0 = xDomain && Number.isFinite(xDomain[0]) ? xDomain[0] : dataX[0]
  const x1 = xDomain && Number.isFinite(xDomain[1]) ? xDomain[1] : dataX[1]
  // Automatic y follows what's in view on x.
  const ys = all.filter((p) => p.x >= x0 && p.x <= x1).map((p) => p.y)
  let [y0, y1]: Domain = ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1]
  if (robustY && ys.length >= 10) {
    const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
    const m = med(ys)
    const spread = Math.max(6 * med(ys.map((y) => Math.abs(y - m))), 3)
    y0 = Math.max(y0, m - spread); y1 = Math.min(y1, m + spread)
  }
  { const pad = (y1 - y0) * 0.08 || 1; y0 -= pad; y1 += pad }
  if (yDomain) {
    if (Number.isFinite(yDomain[0])) y0 = yDomain[0]
    if (Number.isFinite(yDomain[1])) y1 = yDomain[1]
  }

  const plotW = W - PAD.left - PAD.right, plotH = H - PAD.top - PAD.bottom
  const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * plotW
  const sy = (y: number) => {
    const f = (y - y0) / (y1 - y0 || 1)
    return invertY ? PAD.top + f * plotH : H - PAD.bottom - f * plotH
  }
  const toX = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect()
    return x0 + (((clientX - box.left) / box.width) * W - PAD.left) / plotW * (x1 - x0)
  }
  const toY = (clientY: number) => {
    const box = svg.current!.getBoundingClientRect()
    const f = (((clientY - box.top) / box.height) * H - PAD.top) / plotH
    return invertY ? y0 + f * (y1 - y0) : y1 - f * (y1 - y0)
  }

  // Wheel zoom needs a non-passive listener so the page doesn't scroll at the same time.
  const latest = useRef({ x0, x1, y0, y1, dataX, onXDomain, onYDomain, toX, toY })
  latest.current = { x0, x1, y0, y1, dataX, onXDomain, onYDomain, toX, toY }
  useEffect(() => {
    const el = svg.current
    if (!el || (!onXDomain && !onYDomain)) return
    const onWheel = (e: WheelEvent) => {
      const l = latest.current
      e.preventDefault()
      const factor = Math.exp(Math.sign(e.deltaY) * 0.15) // > 1 zooms out
      if (e.shiftKey && l.onYDomain) {
        const at = l.toY(e.clientY)
        l.onYDomain([at - (at - l.y0) * factor, at + (l.y1 - at) * factor])
      } else if (l.onXDomain) {
        const at = l.toX(e.clientX)
        const lo = Math.max(l.dataX[0], at - (at - l.x0) * factor)
        const hi = Math.min(l.dataX[1], at + (l.x1 - at) * factor)
        l.onXDomain(hi - lo >= 3 ? [lo, hi] : [l.x0, l.x1])
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onXDomain, onYDomain])

  if (all.length < 2) return <div className="chart-empty">Not enough laps yet.</div>

  const yTicks = integerY
    ? [...new Set([1, ...ticks(y0, y1, 8)])].filter((t) => Number.isInteger(t) && t >= Math.min(y0, y1) && t <= Math.max(y0, y1))
    : ticks(y0, y1, 5)
  const xTicks = ticks(x0, x1, Math.max(4, Math.round(W / 90))).filter((t) => Number.isInteger(t))
  const visibleLaps = x1 - x0
  const dots = showPoints && visibleLaps <= 60

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
    if (drag.current && onXDomain) {
      const box = svg.current!.getBoundingClientRect()
      const laps = ((e.clientX - drag.current.startX) / box.width) * W / plotW * (drag.current.domain[1] - drag.current.domain[0])
      const width = drag.current.domain[1] - drag.current.domain[0]
      const lo = Math.min(Math.max(dataX[0], drag.current.domain[0] - laps), dataX[1] - width)
      onXDomain([lo, lo + width])
      return
    }
    setHoverX(Math.min(x1, Math.max(x0, Math.round(toX(e.clientX)))))
  }
  const at = hoverX === null || drag.current ? [] : data
    .map((s) => ({ s, p: s.points.find((p) => p.x === hoverX && p.y !== null) }))
    .filter((v): v is { s: Series; p: { x: number; y: number; marked?: boolean } } => !!v.p)
    .sort((a, b) => (invertY ? a.p.y - b.p.y : b.p.y - a.p.y))
  const zoomable = !!(onXDomain || onYDomain)

  return (
    <div className={`line-chart${zoomable ? ' zoomable' : ''}`}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}
        onPointerMove={onMove}
        onPointerLeave={() => { setHoverX(null); drag.current = null }}
        onPointerDown={(e) => { if (onXDomain && e.button === 0) { drag.current = { startX: e.clientX, domain: [x0, x1] }; e.currentTarget.setPointerCapture(e.pointerId) } }}
        onPointerUp={() => { drag.current = null }}
        onDoubleClick={() => { onXDomain?.(null); onYDomain?.(null) }}>
        <defs>
          <clipPath id={clipId}><rect x={PAD.left} y={PAD.top - 2} width={plotW} height={plotH + 4} /></clipPath>
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
            {dots && !s.decoration && s.points.filter((p) => p.y !== null && !p.marked && p.x >= x0 && p.x <= x1).map((p) => (
              <circle key={p.x} cx={sx(p.x)} cy={sy(p.y!)} r={2.5} fill={s.color} />
            ))}
            {/* Pit laps: hollow markers, ringed with the surface so overlapping lines stay readable. */}
            {s.points.filter((p) => p.marked && p.y !== null).map((p) => (
              <circle key={`m${p.x}`} cx={sx(p.x)} cy={sy(p.y!)} r={4} fill="var(--panel)" stroke={s.color} strokeWidth={2} />
            ))}
          </g>
        ))}
        {/* Direct labels at line ends for 2-4 series; a single series is named by the chart title. */}
        {data.length >= 2 && data.length <= 4 && endLabels(data, sy, x1).map((l) => (
          <text key={l.id} x={W - PAD.right + 6} y={l.y} className="chart-label" dominantBaseline="middle">{l.label}</text>
        ))}
        {hoverX !== null && at.length > 0 && (
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
  if (!(step0 > 0)) return []
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0
  const out: number[] = []
  for (let t = Math.ceil(a / step) * step; t <= b + 1e-9; t += step) out.push(Number(t.toFixed(6)))
  return out
}

/** End-of-line label positions (last point in view), nudged apart so they don't overlap. */
function endLabels(series: Series[], sy: (y: number) => number, xMax: number) {
  const labels = series.map((s) => {
    const last = [...s.points].reverse().find((p) => p.y !== null && p.x <= xMax)
    return last ? { id: s.id, label: s.label, y: sy(last.y!) } : null
  }).filter((l): l is { id: string; label: string; y: number } => !!l).sort((a, b) => a.y - b.y)
  for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 12)
  return labels
}
