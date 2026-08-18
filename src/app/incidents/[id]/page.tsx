import { notFound, redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { IncidentDetail } from '@/components/IncidentDetail'
import { activeBanFor } from '@/lib/bans'
import { can } from '@/lib/grants'
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  VERDICT_LABEL,
  get,
  queue,
} from '@/lib/incidents'
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

  /**
   * WHICH VERDICTS ARE EVEN POSSIBLE, decided here rather than in the browser.
   *
   * Both facts are already on this box: the live roster answers "are they still
   * in the server", and `activeBanFor` — which goes through `bans.isActive`, the
   * one place that decides what banned means — answers "are they already
   * banned". Sending the raw ban row to the client and letting it work out
   * whether the ban is in force would be a second implementation of that rule,
   * and the profile page has already been bitten once by a chip that counted
   * lifted and served bans as active.
   *
   * READ AFTER `get`, not in the Promise.all above, because it needs the
   * subject's license out of the incident.
   */
  const subjectOnline = view.players.some(
    (p) => p.license === incident.subjectLicense,
  )
  const subjectBanned = (await activeBanFor(incident.subjectLicense)) !== null

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
        subjectOnline={subjectOnline}
        subjectBanned={subjectBanned}
        categoryLabel={CATEGORY_LABEL}
        kindLabel={KIND_LABEL}
        verdictLabel={VERDICT_LABEL}
      />
    </AppShell>
  )
}
