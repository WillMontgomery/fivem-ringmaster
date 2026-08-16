import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { PlayerActions } from '@/components/PlayerActions'
import { ProfileView } from '@/components/ProfileView'
import * as audit from '@/lib/audit'
import { avatarFor } from '@/lib/discord'
import * as bans from '@/lib/bans'
import { gameProfileFor } from '@/lib/gameProfile'
import * as incidents from '@/lib/incidents'
import { can } from '@/lib/grants'
import * as players from '@/lib/players'
import type { Profile } from '@/lib/profile'
import { currentAdmin } from '@/lib/session'
import { levelFor } from '@/lib/xp'
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
 *   incidents                   ringmaster-incidents, both directions
 *   match history               NOTHING YET — and it renders as absent
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

/** Identifier reading order. Anything absent from this list sorts after it. */
const ID_ORDER = ['license', 'license2', 'discord', 'fivem', 'xbl', 'live', 'steam']

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

  const [ban, canBan, record, game, actions, against, filed] = await Promise.all([
    bans.banFor(license),
    can(admin.license, 'ban'),
    players.playerFor(license),
    gameProfileFor(license),
    audit.forTarget(license),
    incidents.forSubject(license),
    incidents.filedBy(license),
  ])

  // The Discord id is the newest sighting, not the first: somebody who changed
  // accounts should show the face attached to the one they use now.
  //
  // Resolved AFTER the batch above because it depends on `record`. It is one
  // cached call and it degrades to the default avatar without a bot token, so
  // it cannot hold the page up.
  const discordId = record?.identifiers.discord?.at(-1)?.value ?? null
  const avatarUrl = await avatarFor(discordId)

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
    avatarUrl,

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
    // A FIXED ORDER, NOT ALPHABETICAL. License and license2 are the two this
    // system actually keys on, Discord is how a human recognises somebody, and
    // the console identifiers matter least — so that is the reading order.
    // Alphabetical put `discord` above `license`, which buries the identity
    // every other table is joined on. Anything not on the list still renders,
    // after the ones that are.
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
            .sort((a, b) => {
              const rank = (k: string) => {
                const i = ID_ORDER.indexOf(k)
                return i === -1 ? ID_ORDER.length : i
              }
              return (
                rank(a.kind) - rank(b.kind) ||
                a.kind.localeCompare(b.kind) ||
                a.value.localeCompare(b.value)
              )
            })
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
    // THE LEVEL IS DERIVED, NOT READ. The row stores both `xp` and `level`, and
    // only `xp` is trustworthy: it accumulates through an atomic ADD, while
    // `level` is written at match end from a read-modify-write that a stale read
    // or a curve change can leave behind. That is not hypothetical — this page
    // showed level 2 for a player the game showed as level 3, because the game
    // derives and this did not.
    //
    // lib/xp.ts is a second implementation of the Lua curve, pinned to it by
    // scripts/check-xp-curve.mjs. Deriving in both places is what makes the two
    // screens agree; the fixture is what keeps them agreeing.
    progress: game
      ? {
          level: levelFor(game.xp),
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

    // EVERY KICK AND BAN, FROM THE AUDIT LOG. The bans table holds one row per
    // license, so a second ban overwrites the first — `p.bans` above is the
    // CURRENT ban only, and this is the history. They are different questions
    // and the page asks both.
    actions: actions.map((a) => ({
      at: a.ts,
      action: a.action,
      outcome: a.outcome,
      actorName: a.actorName,
      actorLicense: a.actorLicense,
      reason: a.reason,
    })),

    // REAL NOW. Both directions matter: what has been filed against them, and
    // what they have filed against others -- somebody who reports everybody is
    // itself a signal, and it is only visible if you can see what they sent.
    incidents: against.map((i) => ({
      id: i.incidentId,
      kind: i.kind === 'anticheat' ? ('anticheat' as const)
        : i.kind === 'identifier_reuse' ? ('identifier_reuse' as const)
        : ('report' as const),
      at: i.openedAt,
      summary: i.summary,
      state: i.state,
      reportedBy: i.reporterName ?? undefined,
    })),
    reportsFiled: filed.map((i) => ({
      id: i.incidentId,
      kind: 'report' as const,
      at: i.openedAt,
      summary: i.summary,
      state: i.state,
      reportedBy: i.reporterName ?? undefined,
    })),
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
