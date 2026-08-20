'use client'

import { CalendarClock, Loader2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import { UpdateBadge } from '@/components/UpdateBadge'
import { Badge } from '@/components/ui/badge'
import { phaseOf, useLiveState } from '@/lib/livePoll'
import type { DeployPhase } from '@/lib/serverPhase'
import { cn } from '@/lib/utils'

/**
 * The header's status cluster: how the SERVER is, on every page.
 *
 * ONE COMPONENT BECAUSE THEY ARE ONE STATEMENT. An available update and a
 * maintenance window were independent chips rendered side by side, each
 * deciding on its own whether to appear — and during a deploy they appeared
 * together and argued with a feed chip about a box that was deliberately down.
 * That is a decision about the CLUSTER, so the cluster is a component and the
 * decision is made once, here.
 *
 * THE FEED CHIPS ARE GONE — Live, Falling behind, Feed lost, No data. The
 * owner: "let's hide the live/delayed/feed lost chips." They answered "how old
 * is the picture", which is a real question, but in the header they answered it
 * permanently and loudly: a chip that is present on every page of every route
 * all day is wallpaper until the one time it is not, and the state it most
 * often reported — a restarting server — is now stated properly by the deploy
 * chips below.
 *
 * WHAT WAS REMOVED IS THE DISPLAY, NOT THE READING. `lastPushAt` and
 * `bootEpoch` still arrive on every poll and are still what decides whether a
 * deploy has landed — see `deployPhase`. The chip was a renderer of that state,
 * never its owner, and taking it away changed nothing about what the console
 * knows. It does mean the console no longer surfaces feed staleness OUTSIDE a
 * deploy window; that is the owner's call and it is worth knowing it was made.
 */
export function ServerChips({
  live,
  /**
   * The badge the SERVER render resolved, used until the first poll answers.
   *
   * Otherwise a maintenance window in progress would be invisible for the two
   * seconds after every page load — and the shell already has the row in hand,
   * so seeding costs nothing.
   */
  initialBadge,
  /**
   * And the deploy phase the SERVER render resolved, for the same two seconds
   * and the same reason.
   *
   * IT MATTERS MORE THAN THE BADGE DOES. `initialBadge` covers `deploying`,
   * which is a window state; it cannot express `confirming`, because that phase
   * belongs to a window already marked `complete` and `badgeState` returns null
   * for it. Without this, every navigation during the wait for the server to
   * come back would show a clean header for two seconds and then flip to
   * "Updating" — the console momentarily claiming, on every page load, that a
   * deploy it is actively waiting on is over.
   */
  initialPhase,
}: {
  live: boolean
  initialBadge: 'scheduled' | 'draining' | 'updating' | null
  initialPhase: DeployPhase
}) {
  const polled = useLiveState(live)

  const m = polled?.maintenance
  const badge = m ? m.badge : initialBadge

  /**
   * THE SAME READING THE MAINTENANCE PAGE AND THE TOAST USE, from the same
   * payload. Not a second notion of "are we done": `phaseOf` is the one
   * definition, and if this chip and that page ever disagree it is because they
   * polled at different instants, not because they decided differently.
   */
  const phase = polled ? phaseOf(polled) : initialPhase

  /**
   * MID-UPDATE: ONE CHIP, AND IT IS THE ONLY THING IN THE CLUSTER.
   *
   * IT OUTLIVES THE DEPLOY STEP ON PURPOSE. The phase stays `confirming` after
   * the window is marked complete, until br_ringmaster reports from a process
   * that is not the one we restarted — because the restart is the part an
   * operator actually waits through, and the row going `complete` while
   * FXServer is still booting is precisely when the old code put a green tick
   * over a dead server.
   */
  if (phase === 'deploying' || phase === 'confirming') {
    return (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-md bg-info/10 px-2 py-1 text-xs font-medium uppercase tracking-wider text-info ring-1 ring-inset ring-info/30"
      >
        <Loader2 className="size-3 animate-spin" />
        Updating
      </span>
    )
  }

  /**
   * IT WENT WRONG, AND THE CLUSTER SAYS SO RATHER THAN GOING QUIET.
   *
   * THIS IS THE HALF THAT HAD TO REPLACE "FEED LOST". With the health chips
   * removed, a deploy that killed the game server would otherwise leave the
   * header showing nothing at all — the calmest possible display over the worst
   * state the console can be in. Both terminal phases land here: a host that
   * refused the deploy, and a deploy that ran and never came back.
   *
   * IT CLEARS ITSELF ON EVIDENCE, NOT ON A TIMER. The moment br_ringmaster
   * reports from a new process the phase returns to `idle` and this disappears,
   * so a server that recovers late is not left wearing a failure. A deploy the
   * host refused stays flagged until somebody schedules the next window, which
   * is correct: nothing about it has been resolved.
   */
  if (phase === 'failed' || phase === 'unconfirmed') {
    return (
      <Link
        href="/maintenance"
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-md bg-danger/10 px-2 py-1 text-xs font-medium uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30 transition-colors hover:bg-danger/20"
      >
        <TriangleAlert className="size-3" />
        {phase === 'failed' ? 'Update failed' : 'Server not back'}
      </Link>
    )
  }

  return (
    <>
      <UpdateBadge />
      {badge && (
        /*
          THE WIDEST THING IN THE HEADER, and the one that made the old overlap
          reachable. Below `xl` it keeps the icon and drops the words.

          THE WORD IS THE WHOLE LABEL NOW. It read "Maintenance draining", and
          the owner is right that the noun is padding: this chip sits in a header
          beside an update chip, which does not restate its category, and the
          sidebar's Maintenance item carries the same state in the same words a
          few pixels away. "Draining" is the fact; "Maintenance" was the filing
          cabinet it came out of. `Scheduled` and `Updating` lost the same prefix
          for the same reason.

          THE WORDS NEVER LEAVE THE DOM; they only stop being painted. `sr-only`
          is `position: absolute` and out of flow, so the Badge's `h-5
          overflow-hidden` is unaffected below `xl` -- and because `not-sr-only`
          restores `white-space: normal`, the nowrap has to be put back
          explicitly at `xl`. It is NOT a `title` attribute: those are banned on
          DOM elements (docs/hover-text.md), and this one was excluded by exactly
          the condition that triggered it -- the words hide at narrow widths, and
          narrow overwhelmingly means touch, where `title` never fires at all.
        */
        <Badge
          variant="outline"
          className={cn(
            'gap-1.5 border-0 text-xs font-medium uppercase tracking-wider ring-1 ring-inset',
            badge === 'draining'
              ? 'bg-warn/10 text-warn ring-warn/30'
              : 'bg-info/10 text-info ring-info/30',
          )}
        >
          <CalendarClock className="size-3" />
          <span className="sr-only xl:not-sr-only xl:whitespace-nowrap">
            {badge}
          </span>
        </Badge>
      )}
    </>
  )
}
