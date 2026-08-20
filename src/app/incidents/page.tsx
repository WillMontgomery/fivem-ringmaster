import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { IncidentQueue } from '@/components/IncidentQueue'
import { PageLoading } from '@/components/PageLoading'
import { CATEGORY_LABEL, VERDICT_LABEL, all, queue, type Incident } from '@/lib/incidents'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'

/**
 * The incident queue.
 *
 * THE LANDING VIEW IS WHAT IS WAITING, because an incident nobody sees is the
 * same as no incident. Everything ever filed is one tab away for when somebody
 * is looking for a pattern rather than a job.
 */
export const dynamic = 'force-dynamic'

export default async function IncidentsPage() {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const now = Date.now()
  const view = liveView(now)

  /**
   * THE PENDING READ STAYS ABOVE THE BOUNDARY, and only this one, because its
   * count is the sidebar's incidents badge — shell state, not body state.
   * Pushing it down would mean either a shell that waits for the body anyway or
   * dropping the override and making `AppShell` repeat the same scan. The
   * history read is the slower half and the one worth showing a bar for.
   */
  const pending = await queue()

  return (
    <AppShell
      active="/incidents"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      badges={{ incidents: pending.length }}
      feed={{
        lastPushAt: view.lastPushAt,
        bootEpoch: view.bootEpoch,
        now,
        live: true,
      }}
    >
      <Suspense fallback={<PageLoading />}>
        <Body pending={pending} now={now} />
      </Suspense>
    </AppShell>
  )
}

/** The history read, below the boundary. See `PageLoading` for the split. */
async function Body({ pending, now }: { pending: Incident[]; now: number }) {
  const history = await all()

  return (
    <IncidentQueue
      pending={pending}
      history={history}
      now={now}
      categoryLabel={CATEGORY_LABEL}
      verdictLabel={VERDICT_LABEL}
    />
  )
}
