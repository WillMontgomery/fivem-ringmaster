import { redirect } from 'next/navigation'

import { AppShell } from '@/components/AppShell'
import { DiscordChromeProvider } from '@/components/DiscordChrome'
import { ProfileView } from '@/components/ProfileView'
import { actionsTakenFrom } from '@/lib/actionsTaken'
import * as audit from '@/lib/audit'
import { discordChromeFor } from '@/lib/discord'
import * as bans from '@/lib/bans'
import { gameMatchesFor, gameProfileFor } from '@/lib/gameProfile'
import * as incidents from '@/lib/incidents'
import * as players from '@/lib/players'
import type { Profile } from '@/lib/profile'
import {
  fromIncidentParam,
  incidentHref,
  linksToProfile,
} from '@/lib/profileLink'
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
 *   match history               br-players, one `match#...` row per match (#153)
 *   face, banner, accent        Discord, live, on every render
 *   admin role                  Discord, live, in parallel with the face — the
 *                               same check lib/discordRole runs before writes
 *   discord name history        ringmaster-players, written when it changes
 *   actions this admin took     the audit log again, filtered on actorLicense
 *
 * THE DISCORD HALF IS THE ONLY THING NOT AWAITED HERE, and the only thing on
 * this page that can be slow for a reason outside this system. It is handed to
 * the client as a promise and resolved behind a Suspense boundary. See
 * `discordChrome` below.
 *
 * WHAT THAT BUYS HAS CHANGED, and the sentence that used to be here — "a Discord
 * outage costs a face and never a page" — is no longer true. On the owner's
 * instruction the VIEW now shows a full-page skeleton until Discord's data and
 * images have both landed, so a slow Discord costs the whole page for as long as
 * it is slow. Not awaiting it here still matters, and for a different reason: the
 * response's first byte does not wait five seconds, so the reader gets a page
 * that is visibly loading instead of a browser that is visibly hanging. Both
 * halves of the wait are capped — DISCORD_TIMEOUT_MS in lib/discord.ts, then
 * IMAGE_TIMEOUT_MS in components/DiscordChrome.
 *
 * MATCH HISTORY IS REAL AS OF #153, and it brought a distinction with it that
 * did not exist while the list was permanently empty: an empty list no longer
 * means "never played". A player whose every match predates the feature has
 * career totals and no per-match rows, and must not be shown the same blank
 * panel as somebody who has never connected. ProfileView says which is which,
 * using `stats` to tell them apart.
 *
 * THE READS RUN IN PARALLEL AND NONE OF THEM BLOCKS THE OTHERS. A moderator
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
  searchParams,
}: {
  params: Promise<{ license: string }>
  /**
   * ONE PARAMETER IS READ AND IT IS NOT BELIEVED — see `backTo` below and
   * `lib/profileLink`. Everything else in the query string is ignored, which is
   * what keeps a profile's URL a profile's URL.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await currentAdmin()
  if (!admin) redirect('/login')

  const { license: raw } = await params
  const license = decodeURIComponent(raw)
  const fromIncident = fromIncidentParam(await searchParams)

  const now = Date.now()
  const view = liveView(now)

  // The real snapshot, not a fixture: are they on the server right now?
  const live = view.players.find((p) => p.license === license) ?? null

  /**
   * IS THE ADMIN READING THIS PAGE ON THE SERVER RIGHT NOW? (#192)
   *
   * THE SAME ARRAY, THE SAME PREDICATE, A DIFFERENT LICENSE — deliberately one
   * line below `live` rather than anywhere else, so the two presence facts the
   * moderation bar needs are visibly one reading of one snapshot. Deriving the
   * admin's presence any other way (a second query, a session flag, the
   * pause-menu handoff) would give this page two notions of who is connected
   * that could disagree with each other and with the ONLINE NOW chip.
   *
   * IT IS FALSE FOR AN ADMIN WITH NO LICENSE, which is right and not an
   * accident of `find`: an account whose grant row carries no license cannot be
   * matched to a body in the world, and `/api/spectate` refuses it for the same
   * reason. `undefined === undefined` never fires here because a snapshot row
   * with no license is dropped upstream (see lib/state), but the explicit guard
   * is what makes that a rule rather than a lucky property of the feed.
   */
  const adminLive =
    admin.license !== null &&
    view.players.some((p) => p.license === admin.license)

  // TWO SCOPE READS USED TO SIT IN THIS BATCH AND BOTH ARE GONE.
  //
  // `can(admin.license, 'spectate')` went first (dba5a6a and its UI half),
  // because nothing in this console could grant a `spectate`, so the read only
  // ever returned false and the button was greyed for everybody. That same
  // argument then finished off the rest of the scopes, and `can(admin.license,
  // 'ban')` — which decided whether Ban and Kick were live — went with them.
  // Whoever can open this page can act from it; the routes still re-check
  // Discord before anything happens.
  const [ban, record, game, matches, log, against, filed, origin] =
    await Promise.all([
      bans.banFor(license),
      players.playerFor(license),
      gameProfileFor(license),
      // A SECOND READ OF THE SAME TABLE, and it has to be: the aggregate is a
      // GetItem on one key and the history is a Query over a key range. They
      // are different operations, so they are different calls — but they run in
      // this same batch, so the page costs no extra round trip in wall time.
      gameMatchesFor(license),
      // ONE READ, BOTH DIRECTIONS. What was done to them, and — because this
      // player may themselves be an admin — what they did. See audit.forPlayer.
      audit.forPlayer(license),
      incidents.forSubject(license),
      incidents.filedBy(license),
      /**
       * THE CASE THE URL CLAIMS SENT US HERE, fetched only when it claims one.
       *
       * A GetItem on a key, in a batch that already holds two table scans, so
       * it costs nothing in wall time — and `null` when there is no `?from=`,
       * which is every other way into this page.
       *
       * IT IS FETCHED IN ORDER TO BE CHECKED. `linksToProfile` below is the
       * whole point; see `lib/profileLink` for why a query parameter naming an
       * incident cannot be rendered as a link on the strength of naming one.
       */
      fromIncident ? incidents.get(fromIncident) : Promise.resolve(null),
    ])

  /**
   * WHERE THE BREADCRUMB GOES BACK TO (owner, playtest: "Clicking on the
   * player's profile in the incident page takes me to the player's profile page
   * - great! But the breadcrumbs there say 'back to live players' and it should
   * instead take me back to the incident").
   *
   * `undefined` IS THE ORDINARY ANSWER and means "the live players table", which
   * is what every other route into this page gets and what the profile has
   * always done. Three ways to land there: no `?from=` at all, a `from` naming
   * an incident that does not exist, and — the one that matters — a `from`
   * naming a real incident that has no link to THIS profile.
   *
   * THAT LAST CHECK IS WHY THE READ EXISTS. Nothing can prove where a reader
   * came from, so this proves the next best thing: that the incident named
   * actually carries a link to this profile, and is therefore a page they could
   * have arrived from. A hand-typed `?from=<somebody else's case>` gets the
   * ordinary breadcrumb rather than a false trail, and never an error — a stale
   * link in a pasted URL is not the reader's fault.
   */
  const backTo =
    origin && linksToProfile(origin, license)
      ? { href: incidentHref(origin.incidentId), label: 'Back to incident' }
      : undefined

  // The Discord id is the newest sighting, not the first: somebody who changed
  // accounts should show the face attached to the one they use now.
  const discordId = record?.identifiers.discord?.at(-1)?.value ?? null

  /*
   * DELIBERATELY NOT AWAITED, and that word is the whole design.
   *
   * This used to be `const avatarUrl = await avatarFor(discordId)`, one line
   * below the batch above, and it was fine while it was a cached hash lookup.
   * It stopped being fine when the owner asked for live styling on every render:
   * an awaited five-second budget is five seconds before the first byte of a
   * page a moderator opened to decide whether to ban somebody, with nothing on
   * screen the entire time.
   *
   * So the promise goes to the client instead. React streams it through the
   * Suspense boundary inside DiscordChromeProvider, which keeps the RSC response
   * flowing: the shell and the skeleton are flushed at once and the Discord chunk
   * lands later, in the same response. Measured on /preview/profile?discord=slow
   * — first paint at 235ms, chrome at 4.06s, one document.
   *
   * IT NO LONGER MEANS THE PAGE IS USABLE MEANWHILE. It used to: the identifiers,
   * the play record and the moderation buttons all rendered while Discord was
   * still thinking. The owner has since asked for the whole page to wait behind
   * skeletons, so what streaming buys now is a page that is visibly loading
   * rather than a request that appears to hang. ProfileView owns that decision;
   * this file owns only the promise.
   *
   * NULL WHEN THERE IS NO DISCORD ID, and null is load-bearing rather than
   * merely falsy: the provider renders no skeleton and waits for nothing in that
   * case (the owner's instruction). A player who has never linked Discord is not
   * a player whose Discord data is loading.
   */
  const discordChrome = discordId
    ? discordChromeFor({
        discordId,
        license,
        // Passed in rather than re-read: the registry row is already here, and
        // the name history lives on it.
        stored: record?.discord,
        now,
      })
    : null

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
          // The COUNT only (#22 item 10). `game.equipped` is deliberately not
          // carried through — the page showed raw market ids for what they were
          // wearing, which the owner asked to drop.
          owned: game.owned.length,
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
    // THE CURRENT ROW, WHATEVER STATE IT IS IN — active, lifted or served. What
    // the profile does with it depends entirely on `banned` below, which is the
    // one place that decides. `liftedAt`/`liftedBy` are deliberately not carried
    // over: nothing reads them, and a lift is already a row of its own in the
    // audit log beneath.
    ban: ban
      ? {
          at: ban.at,
          reason: ban.reason,
          by: ban.byName,
          byLicense: ban.by,
          expiresAt: ban.expiresAt,
        }
      : null,

    // EVERY KICK AND BAN, FROM THE AUDIT LOG. The bans table holds one row per
    // license, so a second ban overwrites the first — `p.ban` above is the
    // CURRENT ban only, and this is the history. They are different questions
    // and the page asks both.
    actions: log.against.map((a) => ({
      at: a.ts,
      action: a.action,
      outcome: a.outcome,
      actorName: a.actorName,
      actorLicense: a.actorLicense,
      reason: a.reason,
    })),

    /*
     * WHAT THIS PERSON DID, one row per act.
     *
     * COLLAPSED BEFORE IT IS BOUNDED, which is the order that matters: a ban
     * issued as an incident verdict is TWO audit rows on purpose (#28), and
     * slicing first could cut such a pair across the boundary. `actionsTakenFrom`
     * is the whole of that rule and it is a pure function, so /preview/profile
     * drives the same code with fixture rows rather than an imitation of it.
     *
     * FIFTY, matching what `forPlayer` allows the other direction. The panel
     * pages at five, so this is a bound on the history rather than on the view.
     */
    actionsTaken: actionsTakenFrom(log.taken).slice(0, 50),

    // REAL NOW. Both directions matter: what has been filed against them, and
    // what they have filed against others -- somebody who reports everybody is
    // itself a signal, and it is only visible if you can see what they sent.
    // THE CATEGORY AND BOTH PARTIES TRAVEL WITH THE ROW (#22 item 5). The
    // profile's incident row is now "Reported for <category> by <filer>", where
    // the category and the filer are separate links — so it needs the category
    // id, the filer's license, and (for the "filed by them" tab, where the
    // filer is the person whose page this is) the subject's.
    incidents: against.map((i) => ({
      id: i.incidentId,
      kind: i.kind === 'anticheat' ? ('anticheat' as const)
        : i.kind === 'identifier_reuse' ? ('identifier_reuse' as const)
        : ('report' as const),
      at: i.openedAt,
      summary: i.summary,
      state: i.state,
      // THE OUTCOME TRAVELS WITH THE ROW (#28). Without it the profile could
      // only say "resolved", which is the exact word that meant both "banned"
      // and "nothing in it" before the verdict existed. `?? null` because
      // absent and null are the same fact here — nobody recorded one — and the
      // row must not carry `undefined` into a client component prop.
      verdict: i.verdict ?? null,
      category: i.category,
      reportedBy: i.reporterName ?? undefined,
      reportedByLicense: i.reporterLicense,
      subjectName: i.subjectName,
      subjectLicense: i.subjectLicense,
    })),
    reportsFiled: filed.map((i) => ({
      id: i.incidentId,
      kind: 'report' as const,
      at: i.openedAt,
      summary: i.summary,
      state: i.state,
      // Both directions carry it. "What happened to the people I reported" is
      // the more interesting of the two lists, not the less — it is how a
      // reporter's track record becomes readable.
      verdict: i.verdict ?? null,
      category: i.category,
      reportedBy: i.reporterName ?? undefined,
      reportedByLicense: i.reporterLicense,
      subjectName: i.subjectName,
      subjectLicense: i.subjectLicense,
    })),
    // REAL SINCE #153, and passed through untouched — including the null,
    // which means the query failed and is NOT the same as an empty list. The
    // view decides how to say each of the three cases; this page does not
    // flatten them into one.
    matches,
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
        ACTIONS IN THE TOP BAR (#22 item 1). Kick and ban used to be a Card of
        their own stacked above the profile; they now sit inside the identity
        bar, beside the name and the online chip. Same reasoning as before — a
        moderator opening a profile has usually already decided something is
        wrong — but without spending a whole panel and a paragraph of help text
        saying so.

        THE THREE FACTS GO OVER, NOT THE ELEMENT. ProfileView builds the buttons
        itself; see the note on its `moderation` prop for why a server-built
        element handed to a client component is the wrong shape here.

        THE CATEGORY LABELS ARE PASSED IN rather than imported by the view.
        `lib/incidents` reaches DynamoDB, so importing it from a client
        component would drag the AWS SDK into the browser bundle. The incident
        queue hands its labels down the same way.
      */}
      {/*
        THE PROMISE CROSSES THE SERVER/CLIENT LINE, NOT AN ELEMENT. Same
        reasoning as the `moderation` prop above: a server-built element handed
        to a client component as a non-`children` prop trips React's dev key
        check. A promise has no such problem — React serialises it as a pending
        chunk, flushes everything around it, and fills it in when it settles.
      */}
      <DiscordChromeProvider promise={discordChrome}>
        <div className="mx-auto max-w-5xl space-y-4">
          <ProfileView
            p={profile}
            now={now}
            banned={bannedNow}
            backTo={backTo}
            categoryLabel={incidents.CATEGORY_LABEL}
            verdictLabel={incidents.VERDICT_LABEL}
            // `ban` NO LONGER TRAVELS HERE. Whether it is in force is
            // `bannedNow` above — `bans.isActive`, the one rule — and it is
            // already going over as `banned` on the line above. The moderation
            // buttons read that same boolean now instead of re-deriving it.
            // BOTH PRESENCE BOOLEANS COME OUT OF THE ONE `view.players` READ
            // above — the player's, and the admin's own. See `adminLive`.
            moderation={{
              online: live !== null,
              adminOnline: adminLive,
            }}
          />
        </div>
      </DiscordChromeProvider>
    </AppShell>
  )
}
