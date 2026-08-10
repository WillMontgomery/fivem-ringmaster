import { Radio, WifiOff } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * How old the picture is, stated before anything drawn from it.
 *
 * This is the most important element on the page and it is deliberately first.
 * Every number below it is a claim about *now*, and the failure mode of a live
 * console is not showing wrong data — it is showing correct data from four
 * minutes ago as though it were current. An operator who kicks the wrong
 * person because the list was stale was failed by this component.
 *
 * So staleness is a colour and a sentence, never a timestamp the reader has to
 * subtract from the clock in their head.
 */

/** Beyond this the feed is late — the game pushes every 2s by default. */
const STALE_MS = 6_000
/** Beyond this, assume the game server or the link is gone. */
const DEAD_MS = 30_000

type Tone = 'live' | 'stale' | 'dead' | 'offline'

function toneOf(ageMs: number | null): Tone {
  if (ageMs === null) return 'offline'
  if (ageMs > DEAD_MS) return 'dead'
  if (ageMs > STALE_MS) return 'stale'
  return 'live'
}

function ago(ms: number): string {
  if (ms < 1_000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m ${Math.floor((ms % 60_000) / 1_000)}s`
}

const TONE = {
  live: {
    shell: 'border-live/25 bg-live/5',
    text: 'text-live',
    dot: 'bg-live',
    glow: 'shadow-[0_0_12px_-2px_var(--live)]',
  },
  stale: {
    shell: 'border-warn/35 bg-warn/5',
    text: 'text-warn',
    dot: 'bg-warn',
    glow: '',
  },
  dead: {
    shell: 'border-danger/40 bg-danger/8',
    text: 'text-danger',
    dot: 'bg-danger',
    glow: '',
  },
  offline: {
    shell: 'border-border bg-card/40',
    text: 'text-muted-foreground',
    dot: 'bg-idle',
    glow: '',
  },
} satisfies Record<Tone, Record<string, string>>

export function FeedStatus({
  ageMs,
  bootEpoch,
  intervalMs = 2_000,
}: {
  ageMs: number | null
  bootEpoch: string | null
  intervalMs?: number
}) {
  const tone = toneOf(ageMs)
  const t = TONE[tone]

  const headline =
    tone === 'offline'
      ? 'No data received'
      : tone === 'dead'
        ? 'Feed lost'
        : tone === 'stale'
          ? 'Falling behind'
          : 'Live'

  const detail =
    tone === 'offline'
      ? 'br_ringmaster has not pushed yet'
      : `last push ${ago(ageMs!)} ago · expected every ${(intervalMs / 1000).toFixed(0)}s`

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'surface-edge flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 transition-colors',
        t.shell,
      )}
    >
      <span className="relative flex size-2.5 shrink-0">
        {tone === 'live' && (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-70',
              t.dot,
            )}
          />
        )}
        <span
          className={cn('relative inline-flex size-2.5 rounded-full', t.dot, t.glow)}
        />
      </span>

      <div className="min-w-0 leading-tight">
        <div className={cn('flex items-center gap-1.5 text-sm font-medium', t.text)}>
          {tone === 'offline' ? (
            <WifiOff className="size-3.5" />
          ) : (
            <Radio className="size-3.5" />
          )}
          {headline}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{detail}</div>
      </div>

      {bootEpoch && (
        <Tooltip>
          <TooltipTrigger
            render={
              <code className="ml-auto shrink-0 rounded-md bg-background/60 px-2 py-1 font-mono text-[10px] text-muted-foreground/80 ring-1 ring-inset ring-border" />
            }
          >
            {bootEpoch}
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[19rem]">
            The game server&rsquo;s boot epoch. It changes on every
            <code className="mx-1 font-mono">restart br_ringmaster</code>, which
            is how events from before a restart stay distinguishable from ones
            after it.
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
