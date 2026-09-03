'use client'

import { Radio, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'

import { feedNow, type Feed } from '@/lib/feedHealth'
import { useLiveState } from '@/lib/livePoll'
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
 *
 * ═══ IT WAS DELETED, AND THE OWNER ASKED FOR IT BACK ═══
 *
 * "let's hide the live/delayed/feed lost chips" removed it outright (`e0e6fca`)
 * — it had one caller, so the file went rather than being left as dead code.
 * Then: "yes please put the live chip back". All three tones return, because
 * they are one component doing one job; a chip that can only ever say the good
 * news is decoration.
 *
 * WHAT IT ANSWERS, AND WHAT IT DOES NOT. This is FEED freshness: is the data on
 * this screen arriving. `UpdateBadge` beside it is DEPLOY state: is the code on
 * the box current. They were confused for each other once already — the header
 * went silent when these chips were removed and `Up to date` was added to fill
 * the gap — so it is worth being explicit that both belong and neither replaces
 * the other. Which of them may appear WHEN is not decided here: see
 * `chipCluster` in lib/serverPhase, which owns the whole cluster.
 *
 * ═══ THE HOVER CARD DID NOT COME BACK WITH IT ═══
 *
 * IT HELD THE FIRST HOVER CARD IN THE APP — "Last update: 4.2s ago" over "The
 * board refreshes every 2s" — and `docs/hover-text.md` has since ruled twice
 * against restoring it. Rule 8, which sits above every other rule in that file,
 * is the owner's: "please do not add any helper text to any pages on your own
 * ever". A sentence explaining the poll cadence is exactly that. Rule 5 is the
 * second: "Do not add a fourth chip-shaped card without a visible affordance" —
 * a chip whose explanation is hidden until somebody happens to point at it is
 * the complaint that got `IdLabel` deleted. The grep in that document returns
 * three hover cards and still does.
 *
 * WHAT IS LOST IS THE EXACT AGE IN SECONDS, and the tone is what anybody acted
 * on. If the owner wants the number back it is theirs to ask for, in their own
 * words — which is what rule 8 asks of us.
 */

/**
 * THE THRESHOLDS AND THE WORD THEY RESOLVE TO MOVED TO `lib/feedHealth`, and
 * this component is now one of two readers of them. The other is
 * `GET /api/health`, which decides from the same numbers whether to answer a
 * checker that this console is unwell. They were both going to need `> 30s
 * means the feed is gone` and a second copy of that number is a second opinion:
 * this chip could then read `Feed lost` while the endpoint an operator points
 * a pager at answered green, with nothing on either surface to say which was
 * right. Only the colours below are this component's own.
 */
const TONE: Record<Feed, { chip: string; label: string }> = {
  live: {
    chip: 'bg-live/10 text-live ring-live/30',
    label: 'Live',
  },
  stale: {
    chip: 'bg-warn/10 text-warn ring-warn/30',
    label: 'Falling behind',
  },
  dead: {
    chip: 'bg-danger/10 text-danger ring-danger/30',
    label: 'Feed lost',
  },
  offline: {
    chip: 'bg-muted/40 text-muted-foreground ring-border',
    label: 'No data',
  },
}

export function FeedStatus({
  lastPushAt: initialLastPushAt,
  now: initialNow,
  live = false,
}: {
  /** Absolute timestamp of the last push, so the age can tick. */
  lastPushAt: number | null
  /** Server-rendered clock, so first paint matches and hydration is clean. */
  now: number
  /** Poll for fresh state. Off in the preview harness, on for the real app. */
  live?: boolean
}) {
  /**
   * The shared poller — same tick, same object, as the board below it, so the
   * chip can never claim an age the table contradicts. `useLiveState` is
   * unchanged since this component was deleted; `view.lastPushAt` still rides
   * every payload, because it is what proves a deployed server came back.
   */
  const polled = useLiveState(live)
  const lastPushAt = polled?.view.lastPushAt ?? initialLastPushAt

  /**
   * THE AGE HAS TO TICK ON ITS OWN, not only when a poll lands — a feed that
   * has stopped produces no polls, which is precisely the state this chip
   * exists to report. It starts from the server-rendered `now` so the first
   * client render matches the markup it is hydrating.
   */
  const [now, setNow] = useState(initialNow)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])

  const ageMs = lastPushAt === null ? null : Math.max(0, now - lastPushAt)
  const tone = feedNow(ageMs)
  const t = TONE[tone]

  return (
    <span
      role="status"
      aria-live="polite"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium uppercase tracking-wider ring-1 ring-inset transition-colors',
        t.chip,
      )}
    >
      {/*
        Only the icon breathes — a change of intensity that reads as "alive"
        without a word or a number moving. The owner asked for "the green Live
        one with the pulsing icon" by name, so `animate-fade-pulse` is the part
        of this component that was actually requested.
      */}
      {tone === 'offline' ? (
        <WifiOff className="size-3" />
      ) : (
        <Radio className={cn('size-3', tone === 'live' && 'animate-fade-pulse')} />
      )}
      {/*
        The label stays in the DOM at every width, unlike the maintenance badge
        beside it. That badge is the widest thing in the header and drops its
        words below `xl`; these four are short, and the header grid gives the
        cluster its own track with a min-content floor, so it takes room from
        the search rather than painting over it. See `AppShell`'s header.
      */}
      {t.label}
    </span>
  )
}
