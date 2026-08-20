'use client'

import { useLiveState } from '@/lib/livePoll'
import type * as maint from '@/lib/maintenance'
import { cn } from '@/lib/utils'

/**
 * The three states this badge can show — a subset of the window's states, since
 * `cancelled` and `complete` are not things to badge.
 *
 * DERIVED FROM `badgeState` RATHER THAN SPELLED OUT, because the shell's
 * `NavBadges`, the poller's `MaintenancePhase` and this component all have to
 * mean the same three words, and a fourth hand-written union is how they drift
 * apart. `import type` erases, so naming the module here pulls none of its
 * DynamoDB code into the client bundle.
 */
export type MaintenanceBadgeState = NonNullable<
  ReturnType<typeof maint.badgeState>
>

/**
 * The two sidebar badges.
 *
 * ═══ WHY THEY LEFT `AppShell` AND BECAME CLIENT COMPONENTS ═══
 *
 * They were rendered by the shell from two values it `await`ed on every
 * navigation — `incidents.openCount()` and `maint.current()` — which put a
 * DynamoDB scan and a GetItem on the critical path of all eleven routes before
 * the sidebar could paint. That was the price of a real fix (both chips must
 * show on every page, not only on the page each one counts), and the fix is not
 * in question. The way it was paid for is.
 *
 * SO THE SHELL NO LONGER WAITS FOR EITHER. It renders immediately from what the
 * process already knows — `openCountView()` and `maintenanceView()`, both
 * synchronous in-memory reads — and these components take it from there on the
 * two-second poll that was already running on every page for the header chips.
 * Last-known-good now, correct shortly after, nothing blocked.
 *
 * THIS IS ALSO WHAT COLLAPSES THE MAINTENANCE BADGE ONTO ONE SOURCE. It had
 * two: the shell's own `maint.current()` read, and `/api/state`'s
 * `maintenanceView()`. Two independent readings of one row with nothing
 * asserting they agree — and they genuinely could disagree, because a cold
 * driver cache made the poll say "no window" while a fresh GetItem in the shell
 * said "draining". Both halves now read the driver's cache, so the sidebar
 * badge, the header chip and the poll cannot contradict each other about the
 * same row.
 *
 * SEEDED BY THE SERVER, NOT BLANK UNTIL THE FIRST TICK. `seed` is what the
 * shell rendered; `useLiveState` returns null until the poll answers, and null
 * means "use the seed". So first paint carries a value and there is no flash of
 * an empty sidebar on navigation.
 *
 * NO HELPER TEXT ON EITHER OF THEM. They are data.
 */

/**
 * The unread-incident count.
 *
 * URGENT-COLOURED AND CAPPED. Amber rather than red because red in this
 * console means "dead", and an unreviewed report is not an emergency — it is
 * a queue. Capped at 99+ because the difference between 140 and 200 unread
 * incidents changes nothing about what you do next, and four digits wreck the
 * column.
 *
 * ═══ THREE INPUT STATES, AND TWO OF THEM DRAW NOTHING FOR DIFFERENT REASONS ══
 *
 *   a number > 0  the badge, with the count
 *   0             nothing — the queue is empty and an empty queue is not news
 *   null          nothing — we could not count, which is NOT a claim of zero
 *
 * THE LAST TWO LOOK THE SAME ON SCREEN AND MUST NOT BE THE SAME IN THE CODE.
 * "0 open incidents" and "we could not ask" are different facts; conflating
 * them is how a console ends up quietly asserting an empty queue during an
 * outage. `null` travels all the way from `lib/incidents`, which returns the
 * last value it actually managed rather than substituting a zero on error, and
 * arrives here still distinguishable.
 *
 * `undefined` FROM THE POLL IS "NOT KNOWN" TOO, and it is a real case rather
 * than defensive noise: a tab left open across a console deploy receives a
 * payload written before this field existed. It falls back to the seed instead
 * of being read as an empty queue.
 */
export function IncidentBadge({
  seed,
  live,
}: {
  /** What the server render knew. Used until the first poll answers. */
  seed: number | null
  /** Poll for fresh values. False on the design harness, which uses fixtures. */
  live: boolean
}) {
  const polled = useLiveState(live)
  const n = polled && polled.incidents !== undefined ? polled.incidents : seed

  if (n === null || n <= 0) return null

  return (
    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-warn/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-warn ring-1 ring-inset ring-warn/30">
      {n > 99 ? '99+' : n}
    </span>
  )
}

/**
 * The maintenance state, beside the nav item it belongs to.
 *
 * THE BARE STATE WORD, and here it always was — this badge sits inside the
 * "Maintenance" nav row, so prefixing it would have read "Maintenance
 * maintenance draining". The header chip has now been cut to match (it said
 * "Maintenance draining"), which is what makes the two agree word for word
 * rather than merely in meaning.
 *
 * `updating` PULSES LIKE `draining` DOES. The dot marks the states where
 * something is happening to the server right now as opposed to being planned
 * for later, and a deploy in progress is the strongest case of that there is.
 *
 * THE FALLBACK IS THE SAME EXPRESSION `ServerChips` USES — `m ? m.badge : seed`
 * — so the sidebar badge and the header chip cannot disagree about the row they
 * both render. A payload that carries a maintenance object is believed even
 * when its badge is null, because null there is a real answer ("no window"),
 * not an absence.
 */
export function MaintenanceBadge({
  seed,
  live,
}: {
  /** What the server render knew. Used until the first poll answers. */
  seed: MaintenanceBadgeState | null
  /** Poll for fresh values. False on the design harness, which uses fixtures. */
  live: boolean
}) {
  const polled = useLiveState(live)
  const state = polled?.maintenance ? polled.maintenance.badge : seed

  if (!state) return null

  const active = state === 'draining' || state === 'updating'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wider ring-1 ring-inset',
        state === 'draining'
          ? 'bg-warn/15 text-warn ring-warn/30'
          : 'bg-info/15 text-info ring-info/30',
      )}
    >
      {active && (
        <span
          className={cn(
            'size-1.5 animate-pulse rounded-full',
            state === 'draining' ? 'bg-warn' : 'bg-info',
          )}
        />
      )}
      {state}
    </span>
  )
}
