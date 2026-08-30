import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { LiveBoard } from '@/components/LiveBoard'
import { PageLoading } from '@/components/PageLoading'
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
 * A VALID SESSION IS THE WHOLE REQUIREMENT, here and on every read in the
 * console. There are no permission levels: whoever holds the Discord admin role
 * is a full admin (lib/grants.ts), and writes re-ask Discord at the moment of
 * action. The shape is deliberately "check here", not "the middleware handled
 * it".
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
      {/*
        THE BAR WILL NOT APPEAR ON THIS PAGE, and should not. `liveView` reads
        the snapshot the game server has already pushed into this process — no
        await, nothing to wait for — so the body resolves in the same tick and
        the fallback is never committed. The boundary is here for uniformity and
        so it starts working on its own the day this page needs a real read. See
        `PageLoading`.
      */}
      <Suspense fallback={<PageLoading />}>
        <div>
          <div className="mb-5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Live players
            </h1>
            <p className="text-sm text-muted-foreground">
              Everyone on the server right now, by match and squad.
            </p>
          </div>

          <LiveBoard view={view} now={now} live />
        </div>
      </Suspense>
    </AppShell>
  )
}
