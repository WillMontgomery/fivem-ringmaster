'use client'

import { Radio, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * How old the picture is — in the header, next to the other standing facts
 * about the server.
 *
 * IT LIVES IN THE CHROME BECAUSE IT IS TRUE OF EVERY PAGE, not just the live
 * board. A profile, an audit log and an incident queue are all drawn from the
 * same feed, and "is the data arriving" is the question underneath all of
 * them. It sat on the board as a full-width banner first, which put the most
 * persistent fact on the page in the one place you scroll away from.
 *
 * It still earns the attention it gets. The failure mode of a live console is
 * not showing wrong data — it is showing correct data from four minutes ago as
 * though it were current, and an operator who kicks the wrong person because
 * the list was stale was failed by this component.
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

const TONE: Record<Tone, { chip: string; dot: string; label: string }> = {
  live: {
    chip: 'bg-live/10 text-live ring-live/30',
    dot: 'bg-live',
    label: 'Live',
  },
  stale: {
    chip: 'bg-warn/10 text-warn ring-warn/30',
    dot: 'bg-warn',
    label: 'Falling behind',
  },
  dead: {
    chip: 'bg-danger/10 text-danger ring-danger/30',
    dot: 'bg-danger',
    label: 'Feed lost',
  },
  offline: {
    chip: 'bg-muted/40 text-muted-foreground ring-border',
    dot: 'bg-idle',
    label: 'No data',
  },
}

export function FeedStatus({
  lastPushAt,
  bootEpoch,
  now: initialNow,
  intervalMs = 2_000,
}: {
  /** Absolute timestamp of the last push, so the age can tick. */
  lastPushAt: number | null
  bootEpoch: string | null
  /** Server-rendered clock, so first paint matches and hydration is clean. */
  now: number
  intervalMs?: number
}) {
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ageMs = lastPushAt === null ? null : Math.max(0, now - lastPushAt)
  const tone = toneOf(ageMs)
  const t = TONE[tone]

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="status"
            aria-live="polite"
            className={cn(
              'inline-flex cursor-help items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset transition-colors',
              t.chip,
            )}
          />
        }
      >
        {tone === 'offline' ? (
          <WifiOff className="size-3" />
        ) : (
          <Radio className="size-3" />
        )}
        {t.label}
        {ageMs !== null && (
          <span className="tabular-nums opacity-70">{ago(ageMs)}</span>
        )}
        {tone === 'live' && (
          <span className="relative flex size-1.5">
            <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-70', t.dot)} />
            <span className={cn('relative inline-flex size-1.5 rounded-full', t.dot)} />
          </span>
        )}
      </TooltipTrigger>

      <TooltipContent side="bottom" className="max-w-[21rem]">
        {tone === 'offline' ? (
          <span>
            Nothing has been received from the game server. That is the correct
            display when <code className="font-mono">br_ringmaster</code> is not
            configured — not an error.
          </span>
        ) : (
          <span>
            Last push {ago(ageMs!)} ago; expected every{' '}
            {(intervalMs / 1000).toFixed(0)}s.
            {bootEpoch && (
              <>
                {' '}
                Boot epoch <code className="font-mono">{bootEpoch}</code>, which
                changes on every{' '}
                <code className="font-mono">restart br_ringmaster</code>.
              </>
            )}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
