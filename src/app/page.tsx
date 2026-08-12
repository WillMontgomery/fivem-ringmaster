import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { LiveBoard } from '@/components/LiveBoard'
import { currentAdmin } from '@/lib/session'
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
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const now = Date.now()
  const view = liveView(now)

  return (
    <AppShell
      active="/"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      feed={{ lastPushAt: view.lastPushAt, bootEpoch: view.bootEpoch, now, live: true }}
    >
      <div>
        <div className="mb-5">
          <h1 className="text-[13px]xl font-semibold tracking-tight">Live players</h1>
          <p className="text-sm text-muted-foreground">
            Everyone on the server right now, by match and squad.
          </p>
        </div>

        <LiveBoard view={view} now={now} live />
      </div>
    </AppShell>
  )
}
