'use client'

import { useFormatInstant } from '@/components/PrefsProvider'
import { isRenderableInstant, machineInstant, utcIso } from '@/lib/time'

/**
 * A timestamp in the reader's stated timezone.
 *
 * THIS USED TO BE A COMPONENT BECAUSE OF HYDRATION, and it is worth recording
 * why it no longer needs to be. Its old comment said it plainly: "the server
 * has no idea what timezone the reader is in." So it rendered UTC, and an
 * effect swapped in the browser's zone after mount, and the mismatch in between
 * had to be suppressed.
 *
 * THE CONSOLE ASKS NOW. The zone is a cookie the server reads, so the server
 * and the browser format the same instant from the same input and produce the
 * same string. The effect, the seeded state and the `suppressHydrationWarning`
 * are all gone — keeping them while also rendering correctly on the server
 * would preserve exactly the post-hydration flicker this feature exists to
 * delete.
 *
 * IT STAYS A COMPONENT because it is a client component reading context, and
 * because fourteen call sites already spell it this way.
 *
 * THE ZONE IS ALWAYS NAMED. `formatInstant` appends it. Someone who picked a
 * zone they are not sitting in — the whole reason for asking — would otherwise
 * be reading times that are correct and impossible to check.
 *
 * THE EXACT UTC INSTANT USED TO LIVE ON `title`, AND THAT WAS THE WRONG PLACE.
 * The reason given was sound — somebody comparing a console timestamp against a
 * line in a game-server log needs the unambiguous instant — but a native
 * `title` cannot be selected, cannot be focused, is never announced, and never
 * fires at all on a phone. It served a mouse and nobody else, on an inert
 * `<span>`, at a third of the app's timestamps. See `docs/hover-text.md`.
 *
 * SO IT SPLIT IN TWO. The machine gets `<time dateTime>`, which is what that
 * attribute is for; `<time>` is inline like the `<span>` it replaces, so the
 * thirteen call sites that predate this change lay out identically. The human
 * gets `utc`, which renders the UTC as visible text — off by default, because
 * everywhere else the fact was serving nobody and it dies with the attribute.
 *
 * `utc` IS ON AT ONE SITE, NOT TWO. The audit log is the log-correlation
 * surface and takes it. The incident timeline was the other candidate and does
 * NOT, because its timestamp sits mid-line with the author after it
 * (`<LocalTime /> · {e.byName}`): the stacked UTC is a block box, which splits
 * the inline flow and drops the author onto a line of its own. Turning it on
 * there means restructuring that line first — a deliberate deferral, not an
 * oversight.
 */
export function LocalTime({
  ms,
  /** Include the date. Off for things that are obviously recent. */
  withDate = true,
  /** Include the year. Off in narrow columns — see `FormatInstantOptions`. */
  withYear = true,
  /**
   * Also show the UTC instant, visibly, under the local one.
   *
   * FOR CORRELATION SURFACES ONLY — where somebody is holding a server log in
   * the other window, not on every row that happens to have a time on it.
   *
   * ON ITS OWN LINE, NOT AFTER. Inline, this more than doubled the width of the
   * audit log's timestamp (116px -> 267px measured), and that column is
   * `shrink-0` and right-aligned, so every pixel it gained came straight out of
   * the summary text beside it. Stacked, the correlation pair costs a line of
   * height in one narrow column and no width at all.
   */
  utc = false,
  /**
   * Include seconds. Off everywhere but the artifact carousel — `lib/time`'s
   * `FormatInstantOptions` says why, and why it is a flag here rather than a
   * second component.
   */
  withSeconds = false,
  className,
}: {
  ms: number
  withDate?: boolean
  withYear?: boolean
  utc?: boolean
  withSeconds?: boolean
  className?: string
}) {
  const { format, timeZone } = useFormatInstant()

  if (!isRenderableInstant(ms)) {
    return <span className={className}>—</span>
  }

  /**
   * NOTHING IS PRINTED TWICE. A reader whose zone is already UTC has a local
   * string that IS the UTC instant and already ends in "UTC" — rendering
   * `utcIso` under it produced "17 Aug, 02:09 UTC" above "2026-08-17 02:09 UTC",
   * which is the same fact, twice, in the console's densest table. The rule
   * about a duplicate being noise applies to us too.
   */
  const showUtc = utc && timeZone !== 'UTC'

  return (
    <time className={className} dateTime={machineInstant(ms)}>
      {format(ms, { withDate, withYear, withSeconds })}
      {showUtc && (
        <span className="block text-muted-foreground/70">{utcIso(ms)}</span>
      )}
    </time>
  )
}
