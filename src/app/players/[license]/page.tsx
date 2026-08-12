import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { PlayerActions } from '@/components/PlayerActions'
import { ProfileView } from '@/components/ProfileView'
import * as bans from '@/lib/bans'
import { can } from '@/lib/grants'
import { demoProfile } from '@/lib/profile'
import { currentAdmin } from '@/lib/session'
import { liveView } from '@/lib/state'

/**
 * One player's full record.
 *
 * KEYED ON LICENSE, NOT SERVER ID, and that is not a detail. Server ids are
 * recycled within the minute — a profile URL keyed on one would point at a
 * different human by the time somebody clicked the link in Discord. Every ban,
 * grant and audit row keys on the license for the same reason.
 *
 * WHAT IS REAL HERE AND WHAT IS NOT. Live presence comes from the actual
 * snapshot and the ban record from the actual table — those are the two things
 * a moderator acts on, so they are never fabricated. Stats, incidents and
 * session history are still stand-ins, because the streams behind them (M7b
 * and M5) do not exist; ProfileView labels them as such. This page used to draw
 * ALL of it from a fixture, including whether the person was online, which
 * meant it would happily show a moderator a player who was not there.
 */
export const dynamic = 'force-dynamic'

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ license: string }>
}) {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const { license: raw } = await params
  const license = decodeURIComponent(raw)

  const now = Date.now()
  const view = liveView(now)

  // The real snapshot, not a fixture: are they on the server right now?
  const live = view.players.find((p) => p.license === license) ?? null

  const [ban, canBan] = await Promise.all([
    bans.banFor(license),
    can(admin.license, 'ban'),
  ])

  // Name resolution, best first: whoever is connected now, then whoever the
  // ban record remembers, then nothing. Never a guess.
  const name = live?.name ?? ban?.playerName ?? 'Unknown player'

  // The stand-in sections. Everything the profile shows that has no source yet
  // still comes from here, and ProfileView marks it — see the note above.
  const profile = demoProfile(license, name)

  profile.bans = ban
    ? [
        {
          at: ban.at,
          reason: ban.reason,
          by: ban.byName,
          liftedAt: ban.liftedAt ?? undefined,
          liftedBy: ban.liftedByName ?? undefined,
        },
      ]
    : []

  profile.live = live
    ? {
        src: live.src,
        state: live.state,
        matchId: live.matchId,
        squadId: live.squadId,
        hp: live.hp,
        // The roster holds an inventory per player and deliberately keeps it
        // out of PUBLIC_FIELDS. It is not in the snapshot yet — adding it means
        // widening RINGMASTER_FIELDS, which is a decision to take on purpose
        // rather than by accident.
        inventory: [],
      }
    : null

  return (
    <AppShell
      active="/"
      user={{ name: admin.name, avatarUrl: admin.avatarUrl }}
      feed={{
        lastPushAt: view.lastPushAt,
        bootEpoch: view.bootEpoch,
        now,
        live: true,
      }}
    >
      <div className="max-w-5xl space-y-4">
        <ProfileView p={profile} now={now} />
        <PlayerActions
          license={license}
          name={name}
          ban={ban}
          canBan={canBan}
        />
      </div>
    </AppShell>
  )
}
