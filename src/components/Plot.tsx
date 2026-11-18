import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compile } from '../engine/numeric'
import { parseExpression } from '../engine/parser'
import type { PlotSpec } from '../engine/types'

const W = 800
const H = 450
const SAMPLES = 800

interface View {
  x0: number
  x1: number
  y0: number
  y1: number
}

function niceStep(range: number, target = 8): number {
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag
}

function fmtTick(v: number, step: number): string {
  if (Math.abs(v) < step / 1e6) return '0'
  const digits = Math.max(0, -Math.floor(Math.log10(step)))
  const s = v.toFixed(Math.min(digits, 8))
  return Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(1) : s
}

function autoY(fns: Array<(x: number) => number>, x0: number, x1: number): [number, number] {
  const ys: number[] = []
  for (const f of fns)
    for (let i = 0; i <= 200; i++) {
      const y = f(x0 + ((x1 - x0) * i) / 200)
      if (Number.isFinite(y)) ys.push(y)
    }
  if (ys.length < 2) return [-5, 5]
  ys.sort((a, b) => a - b)
  let lo = ys[Math.floor(ys.length * 0.04)]
  let hi = ys[Math.ceil(ys.length * 0.96) - 1]
  if (hi - lo < 1e-9) {
    lo -= 1
    hi += 1
  }
  const pad = (hi - lo) * 0.15
  lo -= pad
  hi += pad
  // keep the x-axis in view when it is close
  if (lo > 0 && lo < (hi - lo) * 0.5) lo = -(hi - lo) * 0.05
  if (hi < 0 && -hi < (hi - lo) * 0.5) hi = (hi - lo) * 0.05
  return [lo, hi]
}

export function Plot({ spec }: { spec: PlotSpec }) {
  const fns = useMemo(
    () =>
      spec.fns.map((f) => {
        try {
          return compile(parseExpression(f.expr), spec.variable)
        } catch {
          return () => NaN
        }
      }),
    [spec],
  )

  const initial = useMemo<View>(() => {
    const [x0, x1] = spec.xRange ?? [-10, 10]
    const [y0, y1] = autoY(fns, x0, x1)
    return { x0, x1, y0, y1 }
  }, [fns, spec.xRange])

  const [view, setView] = useState<View>(initial)
  const [hover, setHover] = useState<number | null>(null)

  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ px: number; py: number; view: View } | null>(null)

  const sx = useCallback((x: number) => ((x - view.x0) / (view.x1 - view.x0)) * W, [view])
  const sy = useCallback((y: number) => H - ((y - view.y0) / (view.y1 - view.y0)) * H, [view])

  const paths = useMemo(() => {
    const span = view.y1 - view.y0
    return fns.map((f) => {
      let d = ''
      let prev: number | null = null
      for (let i = 0; i <= SAMPLES; i++) {
        const x = view.x0 + ((view.x1 - view.x0) * i) / SAMPLES
        const y = f(x)
        if (!Number.isFinite(y) || Math.abs(y - (view.y0 + view.y1) / 2) > span * 50) {
          prev = null
          continue
        }
        const X = ((x - view.x0) / (view.x1 - view.x0)) * W
        const Y = H - ((y - view.y0) / span) * H
        const jump = prev !== null && Math.abs(y - prev) > span * 2
        d += `${prev === null || jump ? 'M' : 'L'}${X.toFixed(1)},${Y.toFixed(1)}`
        prev = y
      }
      return d
    })
  }, [fns, view])

  // Wheel zoom needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const fx = (e.clientX - r.left) / r.width
      const fy = (e.clientY - r.top) / r.height
      const k = Math.exp(e.deltaY * 0.0015)
      setView((v) => {
        const cx = v.x0 + fx * (v.x1 - v.x0)
        const cy = v.y1 - fy * (v.y1 - v.y0)
        return {
          x0: cx + (v.x0 - cx) * k,
          x1: cx + (v.x1 - cx) * k,
          y0: cy + (v.y0 - cy) * k,
          y1: cy + (v.y1 - cy) * k,
        }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const zoom = (k: number) =>
    setView((v) => {
      const cx = (v.x0 + v.x1) / 2
      const cy = (v.y0 + v.y1) / 2
      return { x0: cx + (v.x0 - cx) * k, x1: cx + (v.x1 - cx) * k, y0: cy + (v.y0 - cy) * k, y1: cy + (v.y1 - cy) * k }
    })

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, view }
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const d = drag.current
    if (d) {
      const dx = ((e.clientX - d.px) / r.width) * (d.view.x1 - d.view.x0)
      const dy = ((e.clientY - d.py) / r.height) * (d.view.y1 - d.view.y0)
      setView({ x0: d.view.x0 - dx, x1: d.view.x1 - dx, y0: d.view.y0 + dy, y1: d.view.y1 + dy })
    }
    setHover(view.x0 + ((e.clientX - r.left) / r.width) * (view.x1 - view.x0))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  const xStep = niceStep(view.x1 - view.x0)
  const yStep = niceStep(view.y1 - view.y0, 6)
  const xTicks: number[] = []
  for (let t = Math.ceil(view.x0 / xStep) * xStep; t <= view.x1; t += xStep) xTicks.push(t)
  const yTicks: number[] = []
  for (let t = Math.ceil(view.y0 / yStep) * yStep; t <= view.y1; t += yStep) yTicks.push(t)
  const axisY = Math.min(Math.max(sy(0), 0), H)
  const axisX = Math.min(Math.max(sx(0), 0), W)

  const hoverValues = hover === null ? [] : fns.map((f) => f(hover))

  return (
    <figure className="plot">
      <div className="plot-toolbar" role="toolbar" aria-label="Graph controls">
        <div className="plot-legend">
          {spec.fns.map((f, i) => (
            <span key={i} className={`legend-item c${i}`}>
              <span className="swatch" aria-hidden="true" />
              {f.label}
            </span>
          ))}
        </div>
        <div className="plot-buttons">
          <button type="button" onClick={() => zoom(0.7)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoom(1 / 0.7)} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => setView(initial)} aria-label="Reset view">
            ⟲
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Graph of ${spec.fns.map((f) => f.expr).join(' and ')}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          drag.current = null
          setHover(null)
        }}
      >
        {spec.ranges?.map(([a, b], i) => {
          const xa = Math.max(0, sx(Math.max(a, view.x0 - 1)))
          const xb = Math.min(W, sx(Math.min(b, view.x1 + 1)))
          return xb > xa ? <rect key={i} className="plot-range" x={xa} y={0} width={xb - xa} height={H} /> : null
        })}
        {xTicks.map((t) => (
          <line key={`gx${t}`} className="grid" x1={sx(t)} x2={sx(t)} y1={0} y2={H} />
        ))}
        {yTicks.map((t) => (
          <line key={`gy${t}`} className="grid" x1={0} x2={W} y1={sy(t)} y2={sy(t)} />
        ))}
        <line className="axis" x1={0} x2={W} y1={axisY} y2={axisY} />
        <line className="axis" x1={axisX} x2={axisX} y1={0} y2={H} />
        {xTicks.map((t) =>
          Math.abs(t) < xStep / 1e6 ? null : (
            <text key={`tx${t}`} className="tick" x={sx(t)} y={Math.min(axisY + 16, H - 4)} textAnchor="middle">
              {fmtTick(t, xStep)}
            </text>
          ),
        )}
        {yTicks.map((t) =>
          Math.abs(t) < yStep / 1e6 ? null : (
            <text
              key={`ty${t}`}
              className="tick"
              x={Math.min(Math.max(axisX - 6, 30), W - 4)}
              y={sy(t) + 4}
              textAnchor="end"
            >
              {fmtTick(t, yStep)}
            </text>
          ),
        )}
        {spec.shade && fns[0] && <path className="plot-shade" d={shadePath(fns[0], spec.shade, view, sx, sy)} />}
        {paths.map((d, i) => (
          <path key={i} className={`curve c${i}`} d={d} />
        ))}
        {spec.points?.map((p, i) =>
          Number.isFinite(p.y) ? (
            <g key={i}>
              <circle className="plot-point" cx={sx(p.x)} cy={sy(p.y)} r={5}>
                <title>{p.label}</title>
              </circle>
            </g>
          ) : null,
        )}
        {hover !== null && (
          <g className="hover">
            <line x1={sx(hover)} x2={sx(hover)} y1={0} y2={H} />
            {hoverValues.map((v, i) =>
              Number.isFinite(v) ? <circle key={i} className={`c${i}`} cx={sx(hover)} cy={sy(v)} r={4} /> : null,
            )}
          </g>
        )}
      </svg>
      <figcaption className="plot-readout" aria-live="off">
        {hover === null
          ? 'Drag to pan, scroll or use the buttons to zoom.'
          : `${spec.variable} = ${hover.toPrecision(4)}` +
            hoverValues
              .map((v, i) => `  ·  ${spec.fns[i].label}: ${Number.isFinite(v) ? v.toPrecision(4) : 'undefined'}`)
              .join('')}
      </figcaption>
    </figure>
  )
}

function shadePath(
  f: (x: number) => number,
  [a, b]: [number, number],
  v: View,
  sx: (x: number) => number,
  sy: (y: number) => number,
): string {
  const lo = Math.max(Math.min(a, b), v.x0)
  const hi = Math.min(Math.max(a, b), v.x1)
  if (hi <= lo) return ''
  const n = 200
  const y0 = sy(0)
  let d = `M${sx(lo)},${y0}`
  for (let i = 0; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n
    const y = f(x)
    const Y = Number.isFinite(y) ? Math.min(Math.max(sy(y), -1e4), 1e4) : y0
    d += `L${sx(x).toFixed(1)},${Y.toFixed(1)}`
  }
  return d + `L${sx(hi)},${y0}Z`
}
