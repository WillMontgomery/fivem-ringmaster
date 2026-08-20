'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { Card } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { humanDuration } from '@/lib/duration'
import { labelFor } from '@/lib/labels'
import type { hostView } from '@/lib/telemetry'

type Sample = ReturnType<typeof hostView>['samples'][number]

/**
 * The host graphs. Recharts, through shadcn's `ChartContainer`.
 *
 * WHAT THIS REPLACED, AND WHY THE OLD REASONING DID NOT SURVIVE. There was a
 * hand-rolled SVG `Sparkline` here, and its header argued the case: a few host
 * metrics do not justify a dependency, and an inline `<path>` inherits the theme
 * for free. Both halves were true. What it could not do was the thing the page
 * is actually for — READ A VALUE OFF THE GRAPH. There was no hover, no tooltip,
 * no axis, no way to answer "what was memory doing four minutes ago". A picture
 * of a trend is not a measurement.
 *
 * THREE CHARTS, TO THE OWNER'S COUNT: "a network in/out graph, and a CPU graph,
 * and a memory graph. 3 total." Network carries two series because in and out
 * are one comparison; the other two carry one each.
 *
 * ONE RANGE SELECTOR OVER ALL THREE, because a spike in the network chart and a
 * spike in the processor chart are the same incident, and three independently
 * ranged charts are a way to conclude they are not.
 *
 * WHERE THE DATA COMES FROM, since it is not where the rest of this console's
 * data comes from. These are NOT ingest fields — nothing the game pushes to
 * /api/ingest carries CPU, memory or network. They arrive the other way round:
 * `lib/telemetry` polls the game box over SSH every 15 seconds, running the
 * `telemetry` verb of `tools/dispatch.sh`, which returns cpuPct, memPct and
 * cumulative rx/tx counters. The rates are differenced from consecutive
 * counters in `rateBetween`. The console reaches for the box; the box never
 * reaches for the console.
 *
 * THE SERIES COLOURS ARE `--chart-1`…`--chart-4` and nothing else. They are
 * defined per theme in globals.css and every one clears 4.5:1 against both
 * surfaces a chart is drawn on, in both themes — scripts/check-contrast.mjs
 * asserts it on every `verify`. The tokens the old sparklines used, `--live` and
 * `--warn`, did NOT clear it in the light theme (4.45:1 and 4.40:1); they still
 * mean what they mean on a status chip, but they are not series colours.
 *
 * NO EXPLANATORY COPY ANYWHERE IN THIS FILE, and that is a standing instruction
 * from the owner rather than a stylistic choice: "please do not add any helper
 * text to any pages on your own ever ... it comes across as 'AI slop' if you're
 * writing text without the context of the person who's using it". Axis labels,
 * units, series names and the values in the tooltip are LABELS and stay. There
 * are no captions, no subtitles, no hints, and the no-data state below is drawn
 * rather than narrated.
 */

/**
 * The client boundary is NOT here in any meaningful sense — it is already open.
 * `HostBoard`, the only thing that renders this in the app, is `'use client'`
 * because it owns the five-second poll, and `src/app/host/page.tsx` above it
 * stays a server component. The directive at the top of this file is therefore
 * belt-and-braces rather than a new boundary: it costs nothing, and it means
 * this module cannot be pulled into a server component by accident and fail at
 * build time with an error thrown from inside Recharts.
 */

/** Series ids, as the machine spells them. Rendered through `labelFor`. */
const SERIES_LABEL: Record<string, string> = {
  cpu: 'Processor',
  memory: 'Memory',
  rx: 'Inbound',
  tx: 'Outbound',
}

/**
 * The ranges worth offering, bounded by what is held.
 *
 * `lib/telemetry` keeps a 120-sample window at one sample per 15 seconds — 30
 * minutes — IN MEMORY, which is the intended design and not a gap waiting to be
 * filled. The console shows what it has observed since it last started; a
 * console up for two minutes has two minutes of history, and that is correct
 * rather than missing. Offering a range longer than 30 minutes would draw a
 * chart that is mostly empty and imply a history nothing keeps.
 */
const RANGES = [
  { value: '5', label: 'Last 5 minutes', ms: 5 * 60_000 },
  { value: '15', label: 'Last 15 minutes', ms: 15 * 60_000 },
  { value: '30', label: 'Last 30 minutes', ms: 30 * 60_000 },
] as const

const DEFAULT_RANGE = '30'

/** Bytes/sec, at the precision a human reads rather than the one measured. */
function rate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
}

/**
 * The same rate, for an AXIS TICK, and the difference is the space.
 *
 * NOT A STYLE PREFERENCE — RECHARTS WORD-WRAPS TICK LABELS AT SPACES. Given a
 * y-axis 62px wide and the label "293.0 KB/s", it breaks it into two tspans and
 * stacks them, so the axis reads as ten half-labels rather than five whole ones.
 * The gutter cannot simply be widened to fit `1023.9 KB/s` without eating the
 * plot. So the tick loses the space and a decimal, the tooltip keeps both, and
 * the axis stays one line per tick at any value.
 */
function rateTick(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)}B/s`
  if (bytesPerSec < 1024 * 1024) return `${Math.round(bytesPerSec / 1024)}KB/s`
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}MB/s`
}

function percent(v: number): string {
  return `${Math.round(v)}%`
}

/**
 * THE TIME AXIS IS RELATIVE, AND THAT IS A CORRECTNESS DECISION RATHER THAN A
 * STYLE ONE.
 *
 * `sample.at` is stamped by the dispatcher ON THE GAME BOX — it is that
 * machine's clock, arriving over SSH, and nothing reconciles it with the clock
 * in the browser reading this page. Rendered as wall-clock times, a box a few
 * seconds off would put "14:32:05" against a sample the operator's own clock
 * calls 14:31:58, and a box with a genuinely wrong clock would put the whole
 * chart in the wrong hour. Every offset here is measured from the LATEST SAMPLE
 * instead, so the axis says "22m before the newest reading" — which is true
 * whatever either clock believes, and is also the question being asked.
 */
function offset(ms: number): string {
  return ms < 1_000 ? 'now' : `${humanDuration(ms)} ago`
}

/**
 * The axis version of the same offset: whole minutes, and no space in it.
 *
 * `humanDuration` renders half of a 30-minute window as "22m 30s", which is the
 * right answer to "when was this reading" and the wrong one to put under a
 * gridline — it is two tokens wide, it wraps, and the half-minute is noise on a
 * scale whose gridlines are ten minutes apart. The exact offset is one hover
 * away and that is where precision belongs.
 */
function offsetTick(ms: number): string {
  if (ms < 1_000) return 'now'
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`
  return `${Math.round(ms / 60_000)}m`
}

/**
 * Gridlines on round numbers, counted BACK FROM THE NEWEST SAMPLE.
 *
 * Dividing the range into four equal parts is the obvious thing and it produces
 * "22m 30s" and "7m 30s" on a 30-minute window — ticks at times nobody thinks
 * in. Stepping by a round number of minutes from the right-hand edge instead
 * puts them on 10, 20, 30, and guarantees the edge itself is a tick, which is
 * the one label on the axis that always wants to be there: `now`.
 */
function tickStops(from: number, anchor: number): number[] {
  const span = anchor - from
  const step = span <= 5 * 60_000 ? 60_000 : span <= 15 * 60_000 ? 5 * 60_000 : 10 * 60_000
  const out: number[] = []
  for (let t = anchor; t >= from - 1; t -= step) out.push(t)
  return out.reverse()
}

interface Row {
  at: number
  cpu: number
  memory: number
  rx: number
  tx: number
}

/**
 * THE AXIS TICK COLOUR, SET HERE BECAUSE THE WRAPPER'S ATTEMPT NO LONGER LANDS.
 *
 * `ChartContainer` carries `[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground`,
 * which is shadcn styling Recharts 2's DOM. Recharts 3 renders tick text under
 * `.recharts-cartesian-axis-tick-LABEL` instead, and a class selector matches
 * whole tokens — `.recharts-cartesian-axis-tick` does not match an element
 * classed `recharts-cartesian-axis-tick-label`. So the rule matches nothing, and
 * Recharts' own hardcoded `#666` paints the ticks.
 *
 * IT IS NOT MERELY THE WRONG GREY, IT IS AN UNREADABLE ONE. #666 on the dark
 * theme's card is 3.25:1 — under the 4.5:1 floor this project holds every other
 * piece of text to, on the labels that say what the chart's numbers MEAN. In the
 * light theme it happens to pass at 5.74:1, which is exactly how a defect like
 * this survives review: whoever looks at it in light mode sees nothing wrong.
 * `--muted-foreground` is 6.46:1 dark and 6.85:1 light.
 *
 * SET AS A PROP RATHER THAN BY PATCHING THE VENDORED SELECTOR, so that
 * re-pulling `ui/chart.tsx` from the registry cannot quietly undo it, and so it
 * keeps working whichever way a future Recharts spells its tick classes.
 */
const TICK = { fill: 'var(--muted-foreground)' } as const

/**
 * A chart with nothing in it. DRAWN, NOT EXPLAINED.
 *
 * THE FAILURE THIS EXISTS TO PREVENT: an area chart handed an empty series
 * draws a flat line along the bottom, and a flat line along the bottom is a
 * MEASUREMENT — it says the box is idle, the network silent, memory free.
 * "We have not heard from the host" and "the host reports zero" are opposite
 * facts and they were about to share a picture.
 *
 * THE SEPARATION IS VISUAL BECAUSE IT IS NOT ALLOWED TO BE VERBAL. The owner's
 * standing rule forbids explanatory copy, so none of the three no-data cases —
 * nothing polled yet, one sample, nothing inside the chosen range — gets a
 * sentence describing itself. What distinguishes this from a real chart is that
 * it has NO AXES, NO GRIDLINES AND NO LINE: a hatched, dashed, empty plate where
 * a plot would be. A flat line at zero has axes and a stroke; this has neither,
 * so the two cannot be confused at a glance.
 *
 * THE TWO WORDS ARE A LABEL, NOT A DESCRIPTION, and they are flagged as the one
 * judgement call in here. Absence rendered with no text at all is legible as
 * "empty" but also legible as "this component failed to render", which is a
 * different message and a worse one. "No data" is the shortest thing that
 * separates them; the owner can replace the string without touching anything
 * else, and nothing about the layout depends on its length.
 */
function NoSeries({ title }: { title: string }) {
  const id = `hatch-${title.replace(/\W/g, '')}`
  return (
    <Card className="surface-edge gap-0 px-4 py-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="relative mt-2 h-[220px] w-full overflow-hidden rounded-lg border border-dashed border-border">
        <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
          <defs>
            <pattern
              id={id}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="var(--muted-foreground)"
                strokeOpacity="0.16"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${id})`} />
        </svg>
        <div className="relative flex h-full items-center justify-center">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            No data
          </span>
        </div>
      </div>
    </Card>
  )
}

/**
 * One row of the hover tooltip: a colour swatch, the series name, the value.
 *
 * WRITTEN OUT RATHER THAN LEFT TO THE DEFAULT because the default prints
 * `item.value.toLocaleString()` — a bare `43` for a percentage and a bare
 * `1467892.4` for a byte rate. Units are not decoration here; "43" and "43%" and
 * "43 MB/s" are three different claims. Supplying `formatter` to
 * `ChartTooltipContent` replaces the entire row including the colour swatch, so
 * the swatch is reproduced rather than lost.
 */
function tooltipRow(fmt: (n: number) => string) {
  return (value: unknown, name: unknown, item: unknown) => {
    const color = (item as { color?: string } | undefined)?.color
    return (
      <div className="flex w-full items-center gap-2">
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
        <span className="text-muted-foreground">
          {labelFor(SERIES_LABEL, String(name ?? ''))}
        </span>
        <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
          {typeof value === 'number' ? fmt(value) : String(value)}
        </span>
      </div>
    )
  }
}

function HostAreaChart({
  title,
  rows,
  domain,
  ticks,
  config,
  keys,
  fmt,
  yTickFormat,
  yDomain,
  yTicks,
  yWidth,
}: {
  title: string
  rows: Row[]
  domain: [number, number]
  ticks: number[]
  config: ChartConfig
  keys: readonly (keyof Row)[]
  /** Full precision, for the tooltip. */
  fmt: (n: number) => string
  /** Compact and space-free, for the axis gutter. See `rateTick`. */
  yTickFormat: (n: number) => string
  yDomain: [number, number | 'auto']
  yTicks?: number[]
  yWidth: number
}) {
  const anchor = domain[1]

  return (
    <Card className="surface-edge gap-0 px-4 py-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>

      <ChartContainer config={config} className="mt-2 aspect-auto h-[220px] w-full">
        {/*
          `accessibilityLayer` IS NOT OPTIONAL ON A CHART WHOSE ONLY READOUT IS A
          HOVER. Everything the old sparklines could not do arrived here as a
          tooltip, and a tooltip that opens on pointer movement alone hands the
          numbers to people with a mouse and gives everybody else a coloured
          shape. Recharts' layer makes the plot focusable and walks it with the
          arrow keys, firing the same tooltip — so the reading is reachable from
          the keyboard, which on this page is the difference between a chart and
          a picture of one.
        */}
        <AreaChart
          accessibilityLayer
          data={rows}
          margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
        >
          {/*
            A GRADIENT PER SERIES, keyed off the `--color-<id>` custom property
            that `ChartStyle` writes for this chart's `data-chart` id under both
            the bare and the `.dark` selector. That indirection is what makes a
            fill theme-aware without this component knowing which theme is on.
          */}
          <defs>
            {keys.map((k) => (
              <linearGradient
                key={String(k)}
                id={`fill-${title}-${String(k)}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={`var(--color-${String(k)})`} stopOpacity={0.35} />
                <stop offset="95%" stopColor={`var(--color-${String(k)})`} stopOpacity={0.03} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid vertical={false} strokeDasharray="3 3" />

          <XAxis
            dataKey="at"
            type="number"
            /*
              THE DOMAIN IS THE SELECTED RANGE, NOT THE DATA'S OWN EXTENT. Fit to
              the data, four samples spanning forty seconds would stretch edge to
              edge and read exactly like a full thirty minutes of history — the
              chart would be lying about its own width. Pinned to the range, a
              short history occupies the right-hand sliver it actually is.
            */
            domain={domain}
            ticks={ticks}
            tickFormatter={(v: number) => offsetTick(anchor - v)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
            tick={TICK}
          />

          <YAxis
            domain={yDomain}
            ticks={yTicks}
            tickFormatter={yTickFormat}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width={yWidth}
            tick={TICK}
          />

          <ChartTooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={
              <ChartTooltipContent
                indicator="dot"
                /* A timestamp and a value. Both are data. */
                labelFormatter={(_, payload) => {
                  const at = (payload?.[0]?.payload as Row | undefined)?.at
                  return at === undefined ? null : offset(anchor - at)
                }}
                formatter={tooltipRow(fmt)}
              />
            }
          />

          {keys.map((k) => (
            <Area
              key={String(k)}
              dataKey={String(k)}
              type="monotone"
              stroke={`var(--color-${String(k)})`}
              strokeWidth={2}
              fill={`url(#fill-${title}-${String(k)})`}
              /*
                NOT STACKED. rx+tx stacked would read as total throughput, which
                is a number nobody asked for, and it would hide whichever of the
                two is smaller — the comparison the chart exists to make.
              */
              dot={false}
              activeDot={{ r: 3 }}
              /*
                ANIMATION OFF, and globals.css states the rule this follows:
                movement means something arrived or changed. `HostBoard` refetches
                every five seconds and hands down a new array each time, so an
                enter animation would replay the entire area sweep twice a
                minute, forever, on a page an operator leaves open for an hour.
              */
              isAnimationActive={false}
            />
          ))}

          {/*
            A LEGEND ONLY WHERE THERE IS SOMETHING TO TELL APART. On the network
            chart it names which band is inbound and which outbound; on the
            single-series charts it would restate the heading directly above it
            in smaller type, which is furniture rather than information.
          */}
          {keys.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
        </AreaChart>
      </ChartContainer>
    </Card>
  )
}

export function HostCharts({ samples }: { samples: Sample[] }) {
  const [range, setRange] = useState<string>(DEFAULT_RANGE)
  const rangeMs = RANGES.find((r) => r.value === range)?.ms ?? RANGES[2].ms

  const { rows, domain, ticks } = useMemo(() => {
    const all: Row[] = samples.map((s) => ({
      at: s.at,
      cpu: s.cpuPct,
      memory: s.memPct,
      rx: s.rxRate,
      tx: s.txRate,
    }))

    if (all.length === 0) {
      return { rows: [], domain: [0, 0] as [number, number], ticks: [] }
    }

    /*
     * ANCHORED ON THE NEWEST SAMPLE RATHER THAN ON `Date.now()`. Same reason the
     * axis is relative: the samples carry the game box's clock. Anchoring on the
     * browser's would put every point in the past — or in the future — by
     * whatever the two machines disagree by, and would make a perfectly healthy
     * chart drift out of its own window on a box with a slow clock.
     */
    const anchor = all[all.length - 1]!.at
    const from = anchor - rangeMs

    return {
      rows: all.filter((r) => r.at >= from),
      domain: [from, anchor] as [number, number],
      ticks: tickStops(from, anchor),
    }
  }, [samples, rangeMs])

  /*
   * ONE NO-DATA TREATMENT COVERING THREE SITUATIONS: nothing polled yet, exactly
   * one sample, and samples that all fall outside the chosen range. They differ
   * in cause and not in what can honestly be drawn — fewer than two points is
   * not a line — and telling them apart would take the explanatory sentence the
   * owner has ruled out. So they share one drawn, wordless empty state, and the
   * range selector stays on screen whenever there is anything at all, because
   * changing the range is the one action that can fix the third case.
   */
  const drawable = rows.length >= 2

  const cpuConfig: ChartConfig = {
    cpu: { label: labelFor(SERIES_LABEL, 'cpu'), color: 'var(--chart-1)' },
  }
  const memConfig: ChartConfig = {
    memory: { label: labelFor(SERIES_LABEL, 'memory'), color: 'var(--chart-2)' },
  }
  const netConfig: ChartConfig = {
    rx: { label: labelFor(SERIES_LABEL, 'rx'), color: 'var(--chart-3)' },
    tx: { label: labelFor(SERIES_LABEL, 'tx'), color: 'var(--chart-4)' },
  }

  /*
   * THE PERCENTAGE AXIS IS FIXED AT 0-100, NOT FITTED. An axis that rescales to
   * its data turns 3% into a chart shaped exactly like 90% — same curve, same
   * fill, and only an axis label nobody reads to tell them apart. The single
   * thing this page conveys is how hard the box is working, and that is a
   * fraction of a known ceiling, so the ceiling stays on screen.
   */
  const pct = {
    yDomain: [0, 100] as [number, number],
    yTicks: [0, 25, 50, 75, 100],
    yWidth: 40,
  }

  return (
    <>
      {samples.length > 0 && <Header range={range} onRange={setRange} />}
      <Panels>
        {drawable ? (
          <>
            <HostAreaChart
              title="Processor"
              rows={rows}
              domain={domain}
              ticks={ticks}
              config={cpuConfig}
              keys={['cpu'] as const}
              fmt={percent}
              yTickFormat={percent}
              {...pct}
            />
            <HostAreaChart
              title="Memory"
              rows={rows}
              domain={domain}
              ticks={ticks}
              config={memConfig}
              keys={['memory'] as const}
              fmt={percent}
              yTickFormat={percent}
              {...pct}
            />
            <FullWidth>
              <HostAreaChart
                title="Network"
                rows={rows}
                domain={domain}
                ticks={ticks}
                config={netConfig}
                keys={['rx', 'tx'] as const}
                fmt={rate}
                yTickFormat={rateTick}
                yWidth={62}
                /*
                  FITTED, unlike the percentages, because throughput has no
                  ceiling to be a fraction of. Floored at zero so a quiet period
                  reads as quiet rather than as whatever the noise happened to be.
                */
                yDomain={[0, 'auto']}
              />
            </FullWidth>
          </>
        ) : (
          <>
            <NoSeries title="Processor" />
            <NoSeries title="Memory" />
            <FullWidth>
              <NoSeries title="Network" />
            </FullWidth>
          </>
        )}
      </Panels>
    </>
  )
}

/**
 * THREE CHARTS, AND THE COUNT IS THE OWNER'S SPECIFICATION RATHER THAN A
 * PREFERENCE: "a network in/out graph, and a CPU graph, and a memory graph.
 * 3 total."
 *
 * Processor and memory pair on the top row because they are the two that are
 * genuinely comparable — same unit, same fixed 0-100 axis, so a glance across
 * them answers "is memory climbing while the processor is flat". Network takes
 * the full width beneath: it is on a different scale, it is the only one
 * carrying two series and therefore a legend, and throughput has the spikiest
 * shape, which is the one that benefits from the extra pixels.
 */
function Panels({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 lg:grid-cols-2">{children}</div>
}

function FullWidth({ children }: { children: React.ReactNode }) {
  return <div className="lg:col-span-2">{children}</div>
}

function Header({ range, onRange }: { range: string; onRange: (v: string) => void }) {
  return (
    <div className="flex justify-end">
      <Select value={range} onValueChange={(v) => onRange((v as string) ?? DEFAULT_RANGE)}>
        <SelectTrigger id="host-range" className="w-44" aria-label="Time range">
          {/* Base UI renders the raw value unless told otherwise — see the note
              in BanDialog, which hit the same thing and where the trigger read
              "1" beside a list saying "24 hours". */}
          <SelectValue placeholder="Range">
            {(value) => RANGES.find((r) => r.value === value)?.label ?? 'Range'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => (
            <SelectItem key={r.value} value={r.value}>
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
