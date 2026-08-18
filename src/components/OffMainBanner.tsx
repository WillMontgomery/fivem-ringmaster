import { GitBranch, Undo2 } from 'lucide-react'
import Link from 'next/link'

import { LocalTime } from '@/components/LocalTime'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
        {/*
          A BUTTON, NOT LINK-STYLED TEXT, AND THAT HALF WAS RIGHT. It was
          underlined text in warn, which put the one thing to DO about this
          banner in the same colour and the same weight as the banner's own
          complaint — so the strip read as three sentences of alarm with a
          fourth underlined one, and nothing in it looked like an action. It
          stays a button.

          IT IS NOT PURPLE ANY MORE, AND THE REASON IS WHERE IT SITS. `default`
          is `--primary`, which in this console means "the main action on this
          page". THIS IS NOT A PAGE. It is a strip in the chrome saying
          something is unusual, and a saturated brand fill inside a warning
          strip competes with the warning for attention — two loud things, one
          of which is decoration. The owner: it "looks very out of place being
          purple".

          `outline` IS THE VARIANT: a neutral fill, so the control reads as a
          control without a saturated block of brand colour competing with the
          warning it sits in. `secondary` was the other candidate and lost on
          measurement — see below.

          THE BORDER IS `--warn` RATHER THAN `--border`, AND THAT IS NOT
          DECORATION, IT IS THE ONLY THING THAT MAKES THIS BUTTON VISIBLE. The
          banner is a `warn/10` wash, and MEASURED against it every neutral
          surface token in the system lands within 1.5:1 — `outline`'s own
          `--border` gives a 1.28:1 edge in light and 1.49:1 in dark, and
          `secondary` is worse still at 1.04:1. WCAG 1.4.11 wants 3:1 for the
          boundary that identifies a control, and a button whose edge is
          invisible is back to being link-styled text, which is exactly what the
          owner rejected in the first place. Swapping the edge to the banner's
          own `--warn` takes it to 3.73:1 light and 10.05:1 dark. Numbers and
          method are in the issue comment.

          `dark:border-warn` IS NOT REDUNDANT. `outline` ships `dark:border-input`,
          and `twMerge` treats a `dark:`-prefixed utility as a different key from
          an unprefixed one — so a bare `border-warn` would be overridden in dark
          mode and the edge would silently fall back to 1.49:1, which is the half
          of this that a screenshot in one theme would never catch.

          NOTHING IS INVENTED HERE. `buttonVariants({ variant: 'outline' })` is
          the exact class list `Button` composes, and `--warn` is the token the
          banner itself is painted from — an existing variant composed with an
          existing semantic colour, not a new shade.

          IT IS `buttonVariants` ON THE LINK RATHER THAN `<Button render={<Link
          />}>`, AND BASE UI SAYS SO ITSELF. Its own docs — installed, at
          node_modules/@base-ui/react/docs/react/components/button.md, under
          "Rendering links as buttons" — rule out putting an anchor through
          `render` on the grounds that a link has its own semantics, and say to
          style the `<a>` directly when one needs to LOOK like a button. The
          mechanics agree: `useButton` merges `type="button"` onto whatever it
          renders with `nativeButton` at its default, or `role="button"` with it
          set false, and the second announces a navigation as a button and costs
          the reader the one thing an anchor tells them. This control goes to
          /maintenance; it does not revert anything by itself.

          SIZED `sm` DELIBERATELY. A default-height button in a 2.5-line strip
          competes with the warning it sits in.
        */}
        <Link
          href="/maintenance"
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'border-warn dark:border-warn',
          )}
        >
          <Undo2 />
          Revert to main
        </Link>
      </div>
    </div>
  )
}
