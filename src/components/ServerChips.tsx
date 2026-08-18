'use client'

import { CalendarClock, Loader2 } from 'lucide-react'

import { FeedStatus } from '@/components/FeedStatus'
import { UpdateBadge } from '@/components/UpdateBadge'
import { Badge } from '@/components/ui/badge'
import { useLiveState } from '@/lib/livePoll'
import { updateInProgress } from '@/lib/serverPhase'
import { cn } from '@/lib/utils'

/**
 * The header's status cluster: how the SERVER is, on every page.
 *
 * ONE COMPONENT BECAUSE THEY ARE ONE STATEMENT. Feed health, an available
 * update and a maintenance window were three independent chips rendered side by
 * side, each deciding on its own whether to appear — and during a deploy all
 * three appeared and argued. "Feed lost" (true, the server is restarting),
 * "Maintenance draining" (false, it finished draining and is now deploying) and
 * an update chip, over a box that is deliberately down. The owner: "let's not
 * show the live/falling behind/etc chips while the server is updating — only
 * show the Updating chip." That is a decision about the CLUSTER, so the cluster
 * is a component and the decision is made once, here.
 *
 * ALWAYS RENDERED, ON EVERY PAGE, WHICH IT WAS NOT. `FeedStatus` was behind
 * `{feed && ...}` in the shell and only seven of the eleven real pages passed
 * the prop — so the Live chip simply did not exist on Audit log, Live config,
 * Kick & ban or Settings. A chip that answers "is the data arriving" is
 * describing the server, not the page you happen to be standing on, and one
 * that vanishes on four routes teaches an operator to stop believing it. The
 * shell now resolves the feed itself and renders this unconditionally.
 *
 * WHY THE SUPPRESSION IS HONEST, AND WHERE THE LINE IS. This hides health chips
 * only on a POSITIVE reading — a window that says a deploy is running, or one
 * that says a deploy just finished and the game has not spoken since. Every
 * other case, including "the driver has never read the row" and "this payload
 * predates the maintenance field", falls through to showing everything. See
 * `updateInProgress`: not knowing shows MORE, never less. Hiding a health chip
 * because we had not polled would be the same class of mistake as claiming an
 * update before the first poll (#26), and it is guarded the same way.
 */
export function ServerChips({
  lastPushAt,
  now,
  live,
  /**
   * The badge the SERVER render resolved, used until the first poll answers.
   *
   * Otherwise a maintenance window in progress would be invisible for the two
   * seconds after every page load — and the shell already has the row in hand,
   * so seeding costs nothing.
   */
  initialBadge,
}: {
  lastPushAt: number | null
  now: number
  live: boolean
  initialBadge: 'scheduled' | 'draining' | 'updating' | null
}) {
  const polled = useLiveState(live)

  const m = polled?.maintenance
  const badge = m ? m.badge : initialBadge
  const updating = updateInProgress({
    state: m?.state,
    completedAt: m?.completedAt,
    lastPushAt: polled?.view.lastPushAt ?? lastPushAt,
    now: polled?.now ?? now,
  })

  /**
   * MID-UPDATE: ONE CHIP, AND IT IS THE ONLY THING IN THE CLUSTER.
   *
   * Not the feed chip greyed, not the update chip alongside — gone. The three
   * suppressed chips all answer questions whose honest answer right now is "the
   * server is restarting", and this chip says that in one place instead of
   * leaving the reader to assemble it from three that look like problems.
   *
   * IT OUTLIVES THE DEPLOY STEP ON PURPOSE. `updateInProgress` stays true after
   * the window is marked complete, until the game pushes again — because the
   * restart is the part an operator actually waits through, and the row going
   * `complete` while FXServer is still booting is precisely when the old code
   * put a green tick over a dead server.
   */
  if (updating) {
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

  return (
    <>
      <FeedStatus lastPushAt={lastPushAt} now={now} live={live} />
      <UpdateBadge />
      {badge && (
        /*
          THE WIDEST THING IN THE HEADER, and the one that made the old overlap
          reachable. Below `xl` it keeps the icon and drops the words.

          THE WORD IS THE WHOLE LABEL NOW. It read "Maintenance draining", and
          the owner is right that the noun is padding: this chip sits in a header
          beside a feed chip and an update chip, none of which restate their
          category, and the sidebar's Maintenance item carries the same state in
          the same words a few pixels away. "Draining" is the fact; "Maintenance"
          was the filing cabinet it came out of. `Scheduled` and `Updating` lost
          the same prefix for the same reason.

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
