import { redirect } from 'next/navigation'

import { AnticheatBoard } from '@/components/AnticheatBoard'
import { AppShell } from '@/components/AppShell'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'

/**
 * Anticheat — what the system is, and what it will do on its own.
 *
 * REFERENCE RATHER THAN A FEED. Individual firings are incidents and belong on
 * that page; this answers the questions asked once and relied on afterwards.
 *
 * The settings come from the live snapshot, so the page cannot claim a
 * threshold or an enforcement mode the server does not actually have.
 *
 * WRITTEN FOR AN ADMIN, NOT A DEVELOPER. The explainer under the status card is
 * tabbed — detection, mitigation, prevention, blind spots — so each question
 * can be answered on its own instead of read end to end. See AnticheatGuide.
 */
export const dynamic = 'force-dynamic'

export default async function AnticheatPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const now = Date.now()
  const view = liveView(now)

  return (
    <AppShell
      active="/anticheat"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      feed={{
        lastPushAt: view.lastPushAt,
        bootEpoch: view.bootEpoch,
        now,
        live: true,
      }}
    >
      <div className="mx-auto max-w-4xl">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Anticheat</h1>
          <p className="text-sm text-muted-foreground">
            Every hit is checked against what the server believes. What it
            catches, what happens next, why there is less to catch than you
            might expect — and, importantly, what it cannot see at all.
          </p>
        </div>

        <AnticheatBoard config={view.anticheat ?? null} />
      </div>
    </AppShell>
  )
}
