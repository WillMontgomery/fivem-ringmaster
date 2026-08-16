import { GitBranch } from 'lucide-react'
import Link from 'next/link'

import { LocalTime } from '@/components/LocalTime'

/**
 * "This server is not running main."
 *
 * ON EVERY PAGE, NOT ON THE MAINTENANCE PAGE, and that is the whole reason it
 * lives in the chrome rather than in the panel that produced it. Parking the
 * box on a branch changes the meaning of everything else in this console: the
 * anticheat is grading a build nobody reviewed, an incident may be a bug in an
 * unmerged commit, and the code somebody is reading on GitHub's main branch is
 * not the code that is running. An admin who opens the Live players page an
 * hour later, having missed the switch entirely, has to be told without
 * clicking anything.
 *
 * A BANNER RATHER THAN A HEADER CHIP. The chips in the header are for states
 * that resolve on their own — a maintenance window drains, an update gets
 * deployed. This one resolves only when a human decides it should, so it is
 * sized to be impossible to stop noticing rather than to be glanced at.
 *
 * RENDERS NOTHING WHEN THE HOST HAS NOT ANSWERED. Absence of an answer is
 * handled upstream by `isOnMain`, which reads "unknown" as off main so the
 * AUTOMATION turns off — but showing this banner on the strength of a host we
 * simply have not reached yet would put a permanent red bar over a console
 * whose SSH channel is merely unconfigured. Different question, different safe
 * default: gate the automation pessimistically, gate the alarm on a fact.
 */
export function OffMainBanner({
  deployedRef,
  by,
  at,
}: {
  /** The ref the box is actually running. Falsy, or 'main', renders nothing. */
  deployedRef?: string | null
  /** Who staged the pin, when the pin and the running ref agree. */
  by?: string | null
  at?: number | null
}) {
  if (!deployedRef || deployedRef === 'main') return null

  return (
    <div className="border-b border-warn/30 bg-warn/10 px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <GitBranch className="size-4 shrink-0 text-warn" />
        <span className="font-medium text-warn">
          This server is not running main.
        </span>
        <span className="text-foreground">
          It is on{' '}
          <code className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-xs">
            {deployedRef}
          </code>
          {by ? <> — switched by {by}</> : null}
          {at ? (
            <>
              {' '}
              <LocalTime ms={at} />
            </>
          ) : null}
          .
        </span>
        <span className="text-muted-foreground">
          Automatic updates are paused while it is parked.
        </span>
        <Link
          href="/maintenance"
          className="font-medium text-warn underline underline-offset-2 hover:text-warn/80"
        >
          Revert to main
        </Link>
      </div>
    </div>
  )
}
