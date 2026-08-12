'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A small filled area chart, hand-rolled in SVG.
 *
 * NO CHART LIBRARY on purpose. A handful of host metrics do not justify a
 * dependency, and a hand-rolled SVG inherits the theme for free (it draws in
 * the status vars), scales cleanly, and cannot pull a second copy of React into
 * the tree. The gamemode's NUI makes the same call for the same reason.
 *
 * IT ANIMATES ON ARRIVAL rather than snapping. When a new sample lands the
 * series would otherwise jump one slot to the left between renders, which reads
 * as a stutter; instead the whole plot starts one slot to the right and eases
 * home, so the newest point slides in from the edge. The current value counts
 * up to its new number over the same beat. Both are gated on
 * prefers-reduced-motion — someone who has asked the OS to stop moving things
 * gets the final frame with no travel.
 */

const cubic = 'cubic-bezier(0.16, 1, 0.3, 1)'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Ease-out for the number count-up, matched to the slide's feel. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export function Sparkline({
  values,
  max,
  color = 'var(--primary)',
  height = 64,
  format,
  label,
  current,
  axisLeft,
  axisRight = 'now',
}: {
  values: number[]
  /** Fixed ceiling (e.g. 100 for a percentage) or omit to scale to the data. */
  max?: number
  color?: string
  height?: number
  /** Renders the current value; defaults to the raw number. */
  format?: (v: number) => string
  label: string
  current: number
  /** Time-axis captions: how far back the left edge reaches, and the right. */
  axisLeft?: string
  axisRight?: string
}) {
  const w = 240
  const h = height
  const pad = 2
  const n = values.length

  const ceiling = max ?? Math.max(1, ...values)
  const fmt = format ?? ((v: number) => String(Math.round(v)))

  // A single point still deserves a flat line rather than nothing.
  const pts = n === 1 ? [values[0]!, values[0]!] : values
  const count = pts.length

  const x = (i: number) => pad + (i / (count - 1)) * (w - pad * 2)
  const y = (v: number) =>
    h - pad - (Math.min(v, ceiling) / ceiling) * (h - pad * 2)

  const line = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(' ')
  const area = `${line} L${x(count - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`

  const gid = `spark-${label.replace(/\W/g, '')}`

  // --- slide-in on new data -------------------------------------------------
  // One slot as a fraction of the plot width. On a new sample we start the SVG
  // shifted right by a slot (so the old points sit where they were) and ease
  // the offset to zero, sliding everything left by one slot as the new point
  // enters from the right edge.
  const slotPct = count > 1 ? 100 / (count - 1) : 0
  const [tx, setTx] = useState(0)
  const [animate, setAnimate] = useState(false)
  const lastKey = useRef<number | null>(null)

  useEffect(() => {
    const key = count * 1e6 + (pts[count - 1] ?? 0)
    if (
      lastKey.current !== null &&
      key !== lastKey.current &&
      count > 1 &&
      !prefersReducedMotion()
    ) {
      setAnimate(false)
      setTx(slotPct)
      // Two frames: paint the shifted position, then release the transition.
      const id = requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setAnimate(true)
          setTx(0)
        }),
      )
      lastKey.current = key
      return () => cancelAnimationFrame(id)
    }
    lastKey.current = key
  }, [count, slotPct, pts])

  // --- count-up on the current value ---------------------------------------
  const [shown, setShown] = useState(current)
  const shownRef = useRef(current)
  useEffect(() => {
    if (prefersReducedMotion()) {
      shownRef.current = current
      setShown(current)
      return
    }
    const from = shownRef.current
    const to = current
    if (from === to) return
    const start = performance.now()
    const dur = 600
    let raf = 0
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / dur)
      const v = from + (to - from) * easeOut(p)
      shownRef.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [current])

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-base tabular-nums" style={{ color }}>
          {fmt(shown)}
        </span>
      </div>
      <div className="overflow-hidden">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{
            height: `${h}px`,
            transform: `translateX(${tx}%)`,
            transition: animate ? `transform 700ms ${cubic}` : 'none',
          }}
          role="img"
          aria-label={`${label}: ${fmt(current)}`}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {n > 0 ? (
            <>
              <path d={area} fill={`url(#${gid})`} />
              <path
                d={line}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </>
          ) : (
            <line
              x1={pad}
              y1={h / 2}
              x2={w - pad}
              y2={h / 2}
              stroke="var(--border)"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </div>
      {/* Time axis: the graph is meaningless without knowing what span it
          covers, and "last 12 minutes" is the difference between a spike that
          matters and one that scrolled off ten seconds ago. */}
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-muted-foreground/55">
        <span>{n > 1 ? (axisLeft ?? '') : ''}</span>
        <span>{n > 0 ? axisRight : ''}</span>
      </div>
    </div>
  )
}
