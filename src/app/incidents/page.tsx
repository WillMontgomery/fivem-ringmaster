import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { IncidentQueue } from '@/components/IncidentQueue'
import { CATEGORY_LABEL, VERDICT_LABEL, all, queue } from '@/lib/incidents'
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

  const [pending, history] = await Promise.all([queue(), all()])

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
      <IncidentQueue
        pending={pending}
        history={history}
        now={now}
        categoryLabel={CATEGORY_LABEL}
        verdictLabel={VERDICT_LABEL}
      />
    </AppShell>
  )
}
