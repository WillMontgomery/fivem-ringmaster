import { GitBranch } from 'lucide-react'
import Link from 'next/link'

import { Card } from '@/components/ui/card'
import { Wireframe } from '@/components/Wireframe'
import { isParkedOffMain } from '@/lib/ssh'

/**
 * Live config — a DEV-BRANCH surface, not an everyday one (#20).
 *
 * A COMPONENT OVER A REF STRING, deliberately, and for the same reason
 * `MaintenancePanel` takes `initialDeployedRef`: it never asks the host
 * anything, so the same tree renders from the real telemetry poller and from a
 * fixture. Both shapes of this page depend on a state that needs a live game
 * box parked on a branch to produce, which is precisely the kind of thing that
 * ships broken — `/preview/config` renders both without one.
 *
 * WHY IT IS GATED ON THE BRANCH AT ALL. Changing tuning values under a live
 * match is something to do while testing a branch; on the server everyone is
 * playing on it is a way to degrade a match with a mistyped number. So the nav
 * entry is absent on a box running main, and this says why rather than 404ing —
 * somebody following an old bookmark should learn the rule, not conclude the
 * console is broken.
 *
 * `isParkedOffMain` RATHER THAN `!isOnMain`: a dispatcher too old to report its
 * ref answers neither question, and folding that silence in with "off main"
 * would show a dev-only page on every host the console has not reached. Wrong
 * direction for something a human reads. See both functions in `lib/ssh.ts`.
 */
export function ConfigBoard({
  /** What the host says it is running. `null` is a host that has not answered. */
  deployedRef,
}: {
  deployedRef: string | null
}) {
  if (!isParkedOffMain({ deployedRef: deployedRef ?? undefined })) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Live config</h1>
        <Card className="surface-edge mt-4 gap-0 px-5 py-6">
          <div className="flex items-start gap-3">
            <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="space-y-2">
              <p className="text-sm">
                This page only opens when the game server is parked on a branch
                other than{' '}
                <code className="font-mono text-muted-foreground">main</code>.
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {deployedRef
                  ? `The server is running ${deployedRef}.`
                  : 'The game host has not said which branch it is running — the SSH channel may be unconfigured or unreachable.'}{' '}
                Editing tuning values under a live match is a thing to do while
                testing a branch, not on the server people are playing on, so
                the controls are not offered here.
              </p>
              <p className="text-sm text-muted-foreground">
                Park the server on a branch from the{' '}
                <Link
                  href="/maintenance"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Maintenance page
                </Link>
                , and this page comes back on its own.
              </p>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <Wireframe
      title="Live config"
      milestone="M6"
      intent={
        'Change tuning values without a restart, limited to the ones genuinely safe to change live, and start a resource that is not running. Shown only while the server is parked off main, because both are things you do to a box you are testing on. The hot-reloadable split is enforced in code rather than documented and hoped for: a field is hot-reloadable or it is not, and the UI must not offer the ones that are not.'
      }
      needs={[
        'An explicit hot-reloadable allowlist on the game side',
        'Audit logging - a config edit is an admin action like any other',
        "Starting a resource needs a dispatcher verb the game host does not have. tools/dispatch.sh answers exactly status, telemetry, kick, deploy, branches and switchref, and tools/verify.sh asserts that set has not grown. Adding one is a new capability from the console to the box, and it is the game repo's call rather than this one's.",
        "A live FXServer terminal is deliberately NOT part of this. A console taking arbitrary input supersedes the fixed verb set rather than extending it, and needs a persistent channel that does not exist - SSH's forced command is request/response inside a six-second budget. Split out for its own review.",
      ]}
      blocks={[
        { h: 18, label: 'Search settings' },
        {
          h: 40,
          label:
            'Resources - each with its state, and a start button on the stopped ones',
        },
        {
          h: 46,
          label:
            'Combat - the first candidates; /brdamage already proves these flip live',
        },
        {
          h: 34,
          label: 'Read-only values, shown greyed with why they need a restart',
        },
      ]}
    />
  )
}
