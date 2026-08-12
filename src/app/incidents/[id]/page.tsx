import { notFound, redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { IncidentDetail } from '@/components/IncidentDetail'
import { can } from '@/lib/grants'
import { CATEGORY_LABEL, KIND_LABEL, get, queue } from '@/lib/incidents'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'

/**
 * One incident, at a stable URL.
 *
 * KEYED ON A MINTED UUID so the link can be pasted into Discord and still point
 * at the same thing next month. Nothing about the URL encodes who it is about
 * or when it happened, because both of those can be edited and a URL cannot.
 */
export const dynamic = 'force-dynamic'

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const { id } = await params
  const now = Date.now()
  const view = liveView(now)

  const [incident, canResolve, pending] = await Promise.all([
    get(id),
    // Resolving an incident is a moderation decision, so it takes the same
    // scope as acting on a player. Reading one does not.
    can(admin.license, 'ban'),
    queue(),
  ])

  if (!incident) notFound()

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
      <IncidentDetail
        incident={incident}
        canResolve={canResolve}
        categoryLabel={CATEGORY_LABEL}
        kindLabel={KIND_LABEL}
      />
    </AppShell>
  )
}
