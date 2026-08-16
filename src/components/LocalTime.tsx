'use client'

import { useEffect, useState } from 'react'

/**
 * A timestamp in the reader's own timezone.
 *
 * EVERY TIME IN THIS CONSOLE WAS UTC, rendered as `2026-08-16 02:14Z`. That is
 * the right thing to store and the wrong thing to show: an admin deciding
 * whether an incident is from "just now" or "the middle of last night" is doing
 * arithmetic in their head against an offset, every single time, on a page
 * whose whole job is answering that quickly.
 *
 * THE HYDRATION PROBLEM IS WHY THIS IS A COMPONENT AND NOT A FUNCTION. The
 * server has no idea what timezone the reader is in, so formatting during
 * render produces one answer on the server and another in the browser — React
 * calls that a mismatch and, worse, may keep the server's. So the first paint
 * is deliberately UTC and an effect swaps in the local rendering after mount.
 *
 * The swap is invisible in practice and correct in principle: the value shown
 * before hydration is true, just not local.
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
  // The server-rendered fallback. Same shape the console used everywhere
  // before this existed, so nothing jumps by more than the offset.
  const iso = new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z'
  const [text, setText] = useState(iso)

  useEffect(() => {
    if (!Number.isFinite(ms) || ms <= 0) return

    setText(
      new Date(ms).toLocaleString(undefined, {
        year: withDate ? 'numeric' : undefined,
        month: withDate ? 'short' : undefined,
        day: withDate ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    )
  }, [ms, withDate])

  if (!Number.isFinite(ms) || ms <= 0) {
    return <span className={className}>—</span>
  }

  return (
    // `suppressHydrationWarning` because the mismatch is intentional and
    // one-directional: the effect above is the correction, not a bug.
    <span className={className} suppressHydrationWarning title={iso}>
      {text}
    </span>
  )
}
