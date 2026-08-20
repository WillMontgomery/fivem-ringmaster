import { notFound, redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/AppShell'
import { IncidentDetail } from '@/components/IncidentDetail'
import { PageLoading } from '@/components/PageLoading'
import { probe } from '@/lib/artifactStore'
import { activeBanFor } from '@/lib/bans'
import { can } from '@/lib/grants'
import {
  CATEGORY_LABEL,
  KIND_LABEL,
  VERDICT_LABEL,
  get,
  queue,
  type Incident,
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

  /**
   * TWO READS STAY ABOVE THE BOUNDARY, for two different reasons.
   *
   * `queue()` because its length is the sidebar's incidents badge, and the
   * shell cannot be drawn without it.
   *
   * `get()` because of `notFound()` below. Thrown from under a Suspense
   * boundary it would fire after the shell had already been streamed, and a
   * response whose headers have gone cannot be given a 404 status — a dead
   * incident link would answer 200 with a not-found page drawn into it. These
   * URLs get pasted into Discord and outlive the incidents they name, so that
   * status is worth more than moving one read under the bar.
   *
   * The scope check and the ban lookup have no such constraint and do sit
   * below it — see `PageLoading`.
   */
  const [pending, incident] = await Promise.all([queue(), get(id)])

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
      <Suspense fallback={<PageLoading />}>
        <Body
          incident={incident}
          license={admin.license}
          players={view.players}
          now={now}
        />
      </Suspense>
    </AppShell>
  )
}

async function Body({
  incident,
  license,
  players,
  now,
}: {
  incident: Incident
  license: string | null
  /** The live roster, narrowed to the one field the online check reads. */
  players: { license: string | null }[]
  /**
   * THE SAME `now` THE SHELL WAS DRAWN WITH, not a second reading.
   *
   * The timeline uses it to decide whether a match with no recorded end is
   * still inside its deadline. Taking a fresh `Date.now()` here would be a
   * different instant from the one already in the tree, and the whole reason
   * this is threaded through props rather than read in the browser is that the
   * answer must not change between the server render and hydration.
   */
  now: number
}) {
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
   * `activeBanFor` needs the subject's license, which used to mean waiting for
   * `get` before it could start. The incident arrives here already resolved, so
   * it now runs alongside the scope check instead — the same two reads, one
   * round trip. (The scope check: resolving an incident is a moderation
   * decision and takes the same scope as acting on a player. Reading one does
   * not.)
   */
  /**
   * THE ARTIFACT PROBE JOINS THIS `Promise.all` RATHER THAN GETTING ITS OWN
   * WAIT, and it is the reason this list grew from two to three.
   *
   * It is nine HEAD requests against S3 — headers, not pictures — fired in
   * parallel by `probe()`, so the whole thing is one round trip's worth of
   * latency alongside two reads that were already happening. Everything here is
   * under the `Suspense` boundary above, so the shell has already streamed.
   *
   * ON THE SERVER BECAUSE IT HAS TO BE. The bucket blocks public access and the
   * console's credentials are the EC2 instance role on this box; the browser has
   * no way to ask S3 anything. It also keeps the S3 SDK out of the client
   * bundle entirely — see `lib/artifactStore`.
   *
   * IT CANNOT FAIL THE PAGE. `probe()` swallows and logs; the worst outcome is
   * an empty set, which is a state this page has to render correctly anyway.
   */
  const [canResolve, activeBan, artifacts] = await Promise.all([
    can(license, 'ban'),
    activeBanFor(incident.subjectLicense),
    probe(incident.incidentId),
  ])

  const subjectOnline = players.some(
    (p) => p.license === incident.subjectLicense,
  )
  const subjectBanned = activeBan !== null

  return (
    <IncidentDetail
      incident={incident}
      artifacts={artifacts}
      canResolve={canResolve}
      subjectOnline={subjectOnline}
      subjectBanned={subjectBanned}
      now={now}
      categoryLabel={CATEGORY_LABEL}
      kindLabel={KIND_LABEL}
      verdictLabel={VERDICT_LABEL}
    />
  )
}
