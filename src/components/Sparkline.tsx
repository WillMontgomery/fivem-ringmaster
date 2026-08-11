/**
 * A small filled area chart, hand-rolled in SVG.
 *
 * NO CHART LIBRARY on purpose. Three host metrics do not justify a dependency,
 * and a hand-rolled SVG inherits the theme for free (it draws in `currentColor`
 * and the status vars), scales cleanly, and cannot pull a second copy of React
 * into the tree. The gamemode's NUI makes the same call for the same reason.
 *
 * A pure function of its data: given values it draws them, so it renders
 * identically on the server and the client and never causes a hydration
 * mismatch.
 */
export function Sparkline({
  values,
  max,
  color = 'var(--primary)',
  height = 56,
  format,
  label,
  current,
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

  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(count - 1).toFixed(1)},${h} L${x(0).toFixed(1)},${h} Z`

  const gid = `spark-${label.replace(/\W/g, '')}`

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-sm tabular-nums" style={{ color }}>
          {fmt(current)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-14 w-full"
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
  )
}
