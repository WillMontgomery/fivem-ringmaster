import { AppShell } from '@/components/AppShell'
import { ProfileView } from '@/components/ProfileView'
import { DEMO_BADGES, DEMO_USER } from '@/lib/demo'
import { demoProfile } from '@/lib/profile'
import { synthSnapshot } from '@/lib/__fixtures__/synth'

/**
 * One player's full record.
 *
 * KEYED ON LICENSE, NOT SERVER ID, and that is not a detail. Server ids are
 * recycled within the minute — a profile URL keyed on one would point at a
 * different human by the time somebody clicked the link in Discord. Every ban,
 * grant and audit row keys on the license for the same reason.
 */
export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ license: string }>
}) {
  const { license: raw } = await params
  const license = decodeURIComponent(raw)

  // Name from the live snapshot when they happen to be on; the durable record
  // will supply it otherwise.
  const live = synthSnapshot().snapshot.players.find(
    (p) => p.license === license,
  )

  const profile = demoProfile(license, live?.name ?? 'Unknown')

  if (live) {
    profile.live = {
      src: live.src,
      state: live.state,
      matchId: live.matchId,
      squadId: live.squadId,
      hp: live.hp,
      // The roster holds an inventory per player and deliberately keeps it out
      // of PUBLIC_FIELDS. It is not in the snapshot yet — adding it means
      // widening RINGMASTER_FIELDS, which is a decision to take on purpose
      // rather than by accident.
      inventory: [],
    }
  }

  return (
    <AppShell active="/players" user={DEMO_USER} badges={DEMO_BADGES}>
      <div className="mx-auto max-w-5xl">
        <ProfileView p={profile} now={Date.now()} />
      </div>
    </AppShell>
  )
}
