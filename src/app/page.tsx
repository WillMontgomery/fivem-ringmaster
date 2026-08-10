import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { LiveBoard } from '@/components/LiveBoard'
import { auth } from '@/auth'
import { liveView } from '@/lib/state'

/**
 * Live players — the Slice 1 view.
 *
 * THE `auth()` CALL HERE IS THE ACTUAL BOUNDARY. The middleware only sniffs
 * for a session cookie, because it runs on the edge runtime where the DynamoDB
 * adapter cannot; it can be fooled by any cookie of the right name. This runs
 * server-side against the session record, which is what makes revoking an
 * admin take effect immediately rather than whenever a token would have
 * expired.
 *
 * Scope checks are per action and land with the first write path in Slice 2.
 * Everything on this page is read-only, so holding a valid session is the
 * whole requirement for now — but the shape is deliberately "check here",
 * not "the middleware handled it".
 */
export default async function LivePlayersPage() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  const now = Date.now()
  const view = liveView(now)

  return (
    <AppShell
      active="/"
      user={{
        name: session.user.name ?? 'Unknown',
        // Real scopes arrive with the Discord→license mapping. Until then this
        // says what is true rather than inventing a role.
        scopes: [],
      }}
      feed={{ lastPushAt: view.lastPushAt, bootEpoch: view.bootEpoch, now }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">Live players</h1>
          <p className="text-[13px] text-muted-foreground">
            Everyone on the server right now, by match and squad.
          </p>
        </div>

        <LiveBoard view={view} now={now} />
      </div>
    </AppShell>
  )
}
