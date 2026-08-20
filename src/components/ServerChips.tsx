'use client'

import { CalendarClock, Loader2, TriangleAlert } from 'lucide-react'
import Link from 'next/link'

import { FeedStatus } from '@/components/FeedStatus'
import { UpdateBadge } from '@/components/UpdateBadge'
import { Badge } from '@/components/ui/badge'
import { badgeOf, phaseOf, useLiveState } from '@/lib/livePoll'
import { chipCluster, type DeployPhase } from '@/lib/serverPhase'
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
 * THE PRECEDENCE ITSELF LIVES IN `chipCluster`, in lib/serverPhase, and this
 * file only paints what it returns. It was a chain of early returns right here,
 * which was one representation and therefore fine as far as it went — but the
 * thing most worth guaranteeing about this cluster is which chips may NOT
 * appear together, and nothing could assert JSX. As a pure function it is the
 * same single expression AND a case table in `check-chip-suppression.mjs`.
 * Nothing below re-tests a phase or a badge to decide whether to render.
 *
 * THE FEED CHIPS LEFT AND CAME BACK — Live, Falling behind, Feed lost, No data.
 * The owner asked for them hidden ("let's hide the live/delayed/feed lost
 * chips") and `FeedStatus` was deleted outright; they have since asked for it
 * back ("yes please put the live chip back"). It sits ALONGSIDE `UpdateBadge`
 * rather than instead of it: one answers "is the data I am looking at current",
 * the other "is the deployed code current", and the two were conflated once
 * already when the header went silent and `Up to date` was added to fill it.
 *
 * WHAT NEVER DEPENDED ON THE DISPLAY, through both changes: `lastPushAt` and
 * `bootEpoch` arrive on every poll and are what decide whether a deploy has
 * landed — see `deployPhase`. The chip renders that state and has never owned
 * it, which is why removing it changed nothing about what the console knows and
 * why restoring it needed no new data on the wire.
 *
 * ═══ AND THE CLUSTER HAS A RESTING STATE, WHICH IT ONCE LOST ═══
 *
 * TAKING THE FEED CHIPS OUT LEFT NOTHING THAT COULD APPEAR ON AN ORDINARY DAY.
 * Every chip below needs a POSITIVE abnormal reading — a deploy running, a
 * deploy that failed, a maintenance window, an update to ship — so a healthy
 * server with nothing scheduled produced an empty cluster, and the owner
 * reported the header as silent "until AFTER an fxserver update is kicked off".
 * An empty header and a header on a console that has not looked are the same
 * picture, which is the one thing this console tries never to do.
 *
 * `UpdateBadge` NOW CARRIES THAT RESTING STATE — it reports "Up to date" as
 * well as "Update available", off the same positive host reading, and still
 * renders nothing at all when the host has not answered. It is not the feed
 * chip returning under another name: nothing in it reads `lastPushAt` and
 * nothing in it ages.
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
  /**
   * The feed reading the SERVER render resolved, for `FeedStatus`.
   *
   * SAME TWO SECONDS, SAME REASON as the two above — and here it also keeps
   * hydration clean, because the chip's tone is a function of a clock. Rendering
   * the age against a fresh `Date.now()` on the client would let the first
   * client render disagree with the markup it is hydrating.
   */
  lastPushAt,
  now,
}: {
  live: boolean
  initialBadge: 'scheduled' | 'draining' | 'updating' | null
  initialPhase: DeployPhase
  lastPushAt: number | null
  now: number
}) {
  const polled = useLiveState(live)

  /**
   * THE ONE DECISION, MADE ONCE, SOMEWHERE A GATE CAN REACH IT. Everything
   * below is a `&&` on a field of this object — no phase is re-tested and no
   * badge is re-inspected to decide whether a chip appears.
   *
   * TWO WHOLE READINGS GO IN, NOT FOUR LOOSE FIELDS, and that is the fix for
   * the second door the owner's complaint came back through. This used to
   * resolve the two independently — `polled?.maintenance ? … : initialBadge`
   * for the badge, `polled ? phaseOf(polled) : initialPhase` for the phase — so
   * a payload that carried no `maintenance` block took the phase from the POLL
   * and the badge from the SERVER SEED. Two instants, one cluster, and
   * "update available" beside "updating" whenever they disagreed. `phaseOf` and
   * `badgeOf` now answer the same way about the same payload, and `chipCluster`
   * picks one reading or the other rather than a field from each.
   *
   * THE SEED IS UNCHANGED AND STILL COVERS FIRST PAINT. `polled` is null only
   * before the first tick, which is exactly the two seconds `initialBadge` and
   * `initialPhase` were added for.
   */
  const cluster = chipCluster(
    polled ? { phase: phaseOf(polled), badge: badgeOf(polled) } : null,
    { phase: initialPhase, badge: initialBadge },
  )

  return (
    <>
      {/*
        HOW OLD THE PICTURE IS. Suppressed only while a deploy explains the
        silence — see `chipCluster` rungs 1 and 2, where the deploy chip is
        already reporting the dead feed WITH its cause. A drain is not one of
        those: players are still on and the data still matters, which is the
        call `check-chip-suppression.mjs` has made for this state since it was
        written ("draining and the feed has died — must NOT be hidden").
      */}
      {cluster.feed && (
        <FeedStatus lastPushAt={lastPushAt} now={now} live={live} />
      )}

      {/*
        MID-UPDATE: ONE CHIP, AND IT IS THE ONLY THING IN THE CLUSTER.

        IT OUTLIVES THE DEPLOY STEP ON PURPOSE. The phase stays `confirming`
        after the window is marked complete, until br_ringmaster reports from a
        process that is not the one we restarted — because the restart is the
        part an operator actually waits through, and the row going `complete`
        while FXServer is still booting is precisely when the old code put a
        green tick over a dead server.
      */}
      {cluster.phase === 'updating' && (
        <span
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-md bg-info/10 px-2 py-1 text-xs font-medium uppercase tracking-wider text-info ring-1 ring-inset ring-info/30"
        >
          <Loader2 className="size-3 animate-spin" />
          Updating
        </span>
      )}

      {/*
        IT WENT WRONG, AND THE CLUSTER SAYS SO RATHER THAN GOING QUIET.

        THIS IS THE HALF THAT REPLACED "FEED LOST", and it still outranks it now
        that the feed chip is back. Both terminal phases land here: a host that
        refused the deploy, and a deploy that ran and never came back. Beside
        either of them "Feed lost" is the same alarm without the cause attached,
        and the cause is the entire value of these two words.

        IT CLEARS ITSELF ON EVIDENCE, NOT ON A TIMER. The moment br_ringmaster
        reports from a new process the phase returns to `idle` and this
        disappears, so a server that recovers late is not left wearing a
        failure. A deploy the host refused stays flagged until somebody
        schedules the next window, which is correct: nothing about it has been
        resolved.
      */}
      {(cluster.phase === 'failed' || cluster.phase === 'unconfirmed') && (
        <Link
          href="/maintenance"
          role="status"
          aria-live="polite"
          className="inline-flex items-center gap-1.5 rounded-md bg-danger/10 px-2 py-1 text-xs font-medium uppercase tracking-wider text-danger ring-1 ring-inset ring-danger/30 transition-colors hover:bg-danger/20"
        >
          <TriangleAlert className="size-3" />
          {cluster.phase === 'failed' ? 'Update failed' : 'Server not back'}
        </Link>
      )}

      {/*
        IS THE DEPLOYED CODE CURRENT. Gone while a deploy is in flight or has
        just failed, and gone while the server is DRAINING — the owner:
        "'update available' should be superseded by 'draining' chips - they
        should never be displayed together". The reasoning is in `chipCluster`;
        the point here is that this line does not know it, it only renders.
      */}
      {cluster.update && <UpdateBadge />}

      {cluster.window && (
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
            cluster.window === 'draining'
              ? 'bg-warn/10 text-warn ring-warn/30'
              : 'bg-info/10 text-info ring-info/30',
          )}
        >
          <CalendarClock className="size-3" />
          <span className="sr-only xl:not-sr-only xl:whitespace-nowrap">
            {cluster.window}
          </span>
        </Badge>
      )}
    </>
  )
}
