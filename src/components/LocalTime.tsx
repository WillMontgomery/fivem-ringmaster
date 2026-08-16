'use client'

import { useFormatInstant } from '@/components/PrefsProvider'
import { isRenderableInstant } from '@/lib/time'

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
 * because eight call sites already spell it this way.
 *
 * THE ZONE IS ALWAYS NAMED. `formatInstant` appends it. Someone who picked a
 * zone they are not sitting in — the whole reason for asking — would otherwise
 * be reading times that are correct and impossible to check. The exact UTC
 * instant stays on `title` for the moment somebody is comparing a console
 * timestamp against a line in a game-server log.
 */
export function LocalTime({
  ms,
  /** Include the date. Off for things that are obviously recent. */
  withDate = true,
  className,
}: {
  ms: number
  withDate?: boolean
  className?: string
}) {
  const { format, iso } = useFormatInstant()

  if (!isRenderableInstant(ms)) {
    return <span className={className}>—</span>
  }

  return (
    <span className={className} title={iso(ms)}>
      {format(ms, { withDate })}
    </span>
  )
}
