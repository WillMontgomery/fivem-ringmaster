import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { PlayerActions } from '@/components/PlayerActions'
import { ProfileView } from '@/components/ProfileView'
import * as bans from '@/lib/bans'
import { gameProfileFor } from '@/lib/gameProfile'
import { can } from '@/lib/grants'
import * as players from '@/lib/players'
import type { Profile } from '@/lib/profile'
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
 * NOTHING ON THIS PAGE IS FABRICATED ANY MORE. It used to compose a fixture and
 * overwrite the two fields that mattered; now every section has a real source:
 *
 *   identity, names, sessions   ringmaster-players, this console's registry
 *   stats, progression, wallet  br-players, written by the game at match end
 *   live presence               the snapshot feed
 *   bans                        the bans table
 *   incidents, match history    NOTHING YET — and they render as absent
 *
 * THREE READS, IN PARALLEL, AND NONE OF THEM BLOCKS THE OTHERS. A moderator
 * opening a profile is usually trying to answer "who is this and should I act",
 * and the identity half must not be held up by a stats table being slow — so
 * every source degrades to null independently rather than failing the page.
 *
 * ABSENT IS NOT ZERO. A player with no game row gets `stats: null`, which the
 * view renders as "no match recorded" — not as a career of forty losses. That
 * distinction is the entire reason gameProfileFor returns null rather than a
 * zeroed object.
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

  const [ban, canBan, record, game] = await Promise.all([
    bans.banFor(license),
    can(admin.license, 'ban'),
    players.playerFor(license),
    gameProfileFor(license),
  ])

  // Name resolution, best first: what they asked to be called, then whoever is
  // connected now, then the registry, then the ban record. Never a guess.
  const name =
    record?.preferredName ??
    live?.name ??
    record?.name ??
    ban?.playerName ??
    'Unknown player'

  const bannedNow = ban !== null && bans.isActive(ban, now)

  const profile: Profile = {
    license,
    name,

    // ---- identity, from the console's own registry ----
    // THE LICENSE IS ADDED BACK HERE, and its absence was not obvious.
    //
    // The game strips `license` from the identifier map before emitting
    // player_seen — reasonably, since it is the partition key and repeating it
    // inside the row would be redundant storage. But the profile page is not
    // storage: a moderator looking at "every identifier we have" and not seeing
    // the license has to go find it in the URL, and would reasonably conclude
    // it was never captured.
    //
    // Sorted with the license first and the rest alphabetically, so two
    // profiles are comparable at a glance rather than following whatever order
    // a DynamoDB map happened to deserialise in.
    identifiers: [
      { kind: 'license', value: license.replace(/^license:/, ''), firstSeen: record?.firstSeen ?? 0 },
      ...(record
        ? Object.entries(record.identifiers)
            .flatMap(([kind, sightings]) =>
              (sightings ?? []).map((s) => ({
                kind,
                value: s.value,
                firstSeen: s.firstSeen,
              })),
            )
            .filter((id) => id.kind !== 'license')
            .sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
        : []),
    ],
    names: record?.names ?? [],
    firstSeen: record?.firstSeen ?? 0,
    lastSeen: record?.lastSeen ?? 0,
    connected: record
      ? { sessions: record.sessions, playtimeMs: record.playtimeMs }
      : null,

    // ---- career, from the game's own row ----
    // `matches` is the honest test for "has this person played". A row can
    // exist with a balance and no matches, and reporting that as a career of
    // zeroes would be a lie the player could see.
    stats:
      game && game.matches > 0
        ? {
            matches: game.matches,
            wins: game.wins,
            top10s: game.top10s,
            kills: game.kills,
            deaths: game.deaths,
            downs: game.downs,
            revives: game.revives,
            damageDealt: game.damageDealt,
            playtimeMs: game.playtimeSec * 1000,
            soloMatches: game.soloMatches,
            squadMatches: game.squadMatches,
            lastMatchAt: game.lastMatchAt,
          }
        : null,
    progress: game
      ? {
          level: game.level,
          xp: game.xp,
          balance: game.balance,
          owned: game.owned.length,
          equipped: game.equipped,
        }
      : null,

    // ---- live presence, from the snapshot ----
    live: live
      ? {
          src: live.src,
          state: live.state,
          matchId: live.matchId,
          squadId: live.squadId,
          hp: live.hp,
          // The roster holds an inventory per player and deliberately keeps it
          // out of PUBLIC_FIELDS. It is not in the snapshot yet — adding it
          // means widening RINGMASTER_FIELDS, which is a decision to take on
          // purpose rather than by accident.
          inventory: [],
        }
      : null,

    // ---- moderation ----
    bans: ban
      ? [
          {
            at: ban.at,
            reason: ban.reason,
            by: ban.byName,
            liftedAt: ban.liftedAt ?? undefined,
            liftedBy: ban.liftedByName ?? undefined,
          },
        ]
      : [],

    // NO SOURCE YET, AND EMPTY IS THE TRUTHFUL RENDER. The incidents system
    // does not exist, and nothing records per-match session history. These used
    // to be filled from the fixture, which meant a moderator could read an
    // invented anticheat escalation on a real person's profile.
    incidents: [],
    reportsFiled: [],
    recentSessions: [],
  }

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
      {/*
        ACTIONS ABOVE THE RECORD. A moderator opening a profile has usually
        already decided something is wrong; putting the controls under match
        history optimises for the rare visit over the common one.
      */}
      <div className="mx-auto max-w-5xl space-y-4">
        <PlayerActions
          license={license}
          name={name}
          ban={ban}
          online={live !== null}
          canBan={canBan}
        />
        <ProfileView p={profile} now={now} banned={bannedNow} />
      </div>
    </AppShell>
  )
}
