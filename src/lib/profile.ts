/**
 * A player's full record.
 *
 * ALL OF THIS IS REAL NOW. Match history was the last section with no stream
 * behind it, and #153 gave it one. Nothing on this page is fabricated, and
 * anything absent is absent because the source genuinely has nothing — which is
 * rendered as absence rather than as empty-but-plausible. That distinction is
 * load-bearing on a page a moderator acts on.
 *
 * The provenance matters because these come from four different places with
 * four different freshness and trust properties:
 *
 *   live       the current snapshot. Two seconds old at worst, gone on restart.
 *   identity   ringmaster-players, this console's registry. Durable.
 *   stats      br-players, written by the GAME at match end — both the career
 *              aggregate and, since #153, one row per match. Durable, and not
 *              writable from here; Ringmaster only reads it.
 *   moderation Ringmaster's own tables — bans, audit, incidents.
 */

import type { AccentSurface } from './contrast'

export type Provenance = 'live' | 'identity' | 'stats' | 'moderation'

/**
 * One Discord name we watched get replaced.
 *
 * WHY THIS IS STORED WHEN EVERYTHING ELSE DISCORD IS FETCHED LIVE. The rest of
 * the Discord data on this page — avatar, banner, accent — is asked for fresh on
 * every render, because the only useful version of somebody's current styling is
 * the current one. Names are different in kind: `GET /users/{id}` only ever
 * returns the present, so a history of them cannot be derived from it however
 * many times you call it. If Ringmaster does not write down what it saw, the
 * fact that somebody was called something else last week does not exist
 * anywhere.
 *
 * AND IT IS THE FACT THAT MATTERS. Changing your display name is a normal thing
 * to do, and it is also precisely what somebody does after being reported. A
 * moderator opening a profile needs to see "was Slippery Jim until Tuesday"
 * without having to have been watching on Tuesday.
 */
export interface DiscordNameChange {
  /**
   * Which of the two names moved.
   *
   * `globalName` is the display name and changes freely; `username` is the
   * @handle and is rarer and more interesting. They are recorded separately
   * because they mean different things, not because they change together.
   */
  field: 'username' | 'globalName'
  /** The value that was replaced. Never empty — a change from nothing is not one. */
  from: string
  /** What replaced it. Null when they cleared it, which globalName allows. */
  to: string | null
  /**
   * When RINGMASTER first saw the new value — not when Discord applied it.
   *
   * Named `at` rather than `changedAt` for that reason. Nothing here can know
   * when the change actually happened; it can only know when a profile page was
   * opened and the answer had moved. On a player nobody looks at, that could be
   * weeks late, and the UI says "noticed" rather than "changed" because of it.
   */
  at: number
}

/**
 * Everything the profile page draws from Discord, resolved for one render.
 *
 * THIS IS THE ONLY REPRESENTATION. There is no second copy of the avatar hash
 * on the player row shadowing it and no cache in front of it — the page asks
 * Discord, gets this, and draws it. `lib/discord.ts` used to claim a durable
 * copy existed; it did not, and the claim is gone rather than the code having
 * grown one, because two representations of one thing with nothing asserting
 * they agree is this repo's signature failure.
 *
 * `answered` IS NOT `avatarUrl === null`. Discord failing to answer and a
 * player having no avatar set are different facts with the same silhouette, and
 * the page says different things about them.
 */
export interface DiscordChrome {
  /** The Discord user id this was resolved for. */
  id: string
  /**
   * True when Discord answered inside the timeout with a usable body.
   *
   * False covers every failure the same way on purpose — no token, a 404, a
   * rate limit, a five-second silence. None of them is a statement about the
   * player, and the page says so in one sentence rather than five.
   */
  answered: boolean
  /**
   * Always a URL, so the page never has to draw a hole where a face goes.
   *
   * Falls back to Discord's generic default avatar — one of six coloured logos
   * derived from the id — which is a picture but is never that person. See
   * `real` for telling the two apart.
   */
  avatarUrl: string
  /** False when `avatarUrl` is the generic default rather than their picture. */
  real: boolean
  /** Their profile banner, for the blurred backdrop. Null unless they have one. */
  bannerUrl: string | null
  /**
   * Their accent colour, already made safe to put text on.
   *
   * Null when they have not set one. NOT null merely because it was extreme —
   * `accentSurface` clamps rather than rejects, so a white or black accent still
   * arrives here as a usable surface. See lib/contrast.ts.
   */
  accent: AccentSurface | null
  /** The @handle. */
  username: string | null
  /** The display name, which is the one people actually recognise. */
  globalName: string | null
  /** Formerly known as, newest first. From the registry row, not from the API. */
  formerNames: DiscordNameChange[]
}

export interface ProfileIdentifier {
  kind: string
  value: string
  /** When this identifier was first seen against this license. */
  firstSeen: number
}

export interface ProfileIncident {
  id: string
  kind: 'anticheat' | 'report' | 'identifier_reuse'
  at: number
  summary: string
  /**
   * TWO STATES, AND NO WAY BACK (owner, 2026-08-12). `pending_review` is what
   * the nav badge counts. See lib/incidents for why re-opening is disallowed —
   * briefly: it keeps the queue strictly shrinking, and a recurrence is a new
   * incident rather than an old one changing its mind.
   */
  state: 'pending_review' | 'resolved'
  /**
   * What the reporter picked in game — the raw id, e.g. `abusive_chat`.
   *
   * CARRIED RAW AND HUMANISED AT THE EDGE. `lib/incidents` owns the labels and
   * is server-only (it reaches DynamoDB), so the view is handed the map as a
   * prop rather than importing it. Same arrangement the incident queue already
   * uses, for the same reason.
   */
  category: string
  /** For reports: who filed it. Absent for system-filed incidents. */
  reportedBy?: string
  /** The filer's license, so their name can link to their own profile. */
  reportedByLicense?: string | null
  /**
   * Who the incident is ABOUT.
   *
   * Redundant on a profile's own "filed against them" list — it is the person
   * whose page this is — and the whole point of the "filed by them" list, where
   * the interesting other party is the person they reported rather than
   * themselves.
   */
  subjectName?: string
  subjectLicense?: string | null
}

/**
 * One match this player was in, as the game recorded it when it ended.
 *
 * REAL SINCE #153. Nothing wrote these until then — every game-side write went
 * to one aggregate row per player, so this list was permanently empty and the
 * page rendered absence. It is now a genuine per-match record, which means the
 * page has a NEW distinction to make and it matters: an empty list no longer
 * means "never played". It can also mean "played only before this shipped",
 * and those two must not look alike on screen.
 */
export interface ProfileMatch {
  matchId: number
  endedAt: number
  mode: string
  placement: number
  /** Field size. Third of eight and third of ninety-six are different results. */
  total: number
  kills: number
  downs: number
  revives: number
  damage: number
  /** Time alive, not time the match ran. */
  survivedMs: number
  xpEarned: number
  voltsEarned: number
  /** NOT `placement === 1` — a storm can take the last squad standing. */
  won: boolean
}

/** One moderation action, from the append-only audit log. */
export interface ProfileAction {
  at: number
  action: string
  outcome: string
  actorName: string
  /** Links to the acting admin's own profile. Null for system actions. */
  actorLicense: string | null
  reason?: string | null
}

export interface Profile {
  license: string
  name: string

  /*
   * `avatarUrl` USED TO BE HERE and is gone rather than unused.
   *
   * It was resolved on the server, awaited inline, and baked into this object —
   * which held the page's FIRST BYTE for as long as Discord took. Everything
   * Discord-shaped now arrives separately as a `DiscordChrome`, resolved behind
   * its own Suspense boundary, so the response starts immediately and the
   * Discord chunk lands in it later.
   *
   * THAT IS ABOUT THE RESPONSE, NOT ABOUT WHAT IS ON SCREEN. This comment used to
   * end "so a slow call costs the face and nothing else", which stopped being
   * true when the owner asked for the whole profile to sit behind skeletons until
   * Discord is ready. A slow call now costs the page — it just costs it as a
   * loading page rather than as a blank tab. See components/ProfileView.
   *
   * Leaving a second avatar field here would have given the page two places to
   * look for one picture.
   */

  /** identity — the allowlisted scan, minus `ip`, which is never collected. */
  identifiers: ProfileIdentifier[]
  firstSeen: number
  lastSeen: number

  /**
   * stats — REAL NOW, read from the game's own `br-players` row.
   *
   * NULL MEANS "NO MATCH RECORDED", NOT ZERO. A profile showing 0 matches and 0
   * wins reads as somebody who turned up and lost every time; that is a
   * different and much less flattering claim than never having played. The UI
   * has to keep distinguishing the two.
   */
  stats: {
    matches: number
    wins: number
    top10s: number
    kills: number
    deaths: number
    downs: number
    revives: number
    damageDealt: number
    /** In-match time. Distinct from `connected`, which is time on the server. */
    playtimeMs: number
    soloMatches: number
    squadMatches: number
    lastMatchAt: number | null
  } | null

  /** Progression and the market wallet. Same row, same source, same null rule. */
  progress: {
    level: number
    xp: number
    balance: number
    /**
     * How many cosmetics they have bought, and deliberately only the count.
     *
     * `equipped` USED TO RIDE ALONG HERE and is gone rather than merely unshown
     * (#22 item 10, owner: "We don't need to know what cosmetics they own, just
     * 'x cosmetics owned' is enough"). It rendered as `chute: chute_ember` —
     * raw market ids, on a page whose job is deciding whether to ban somebody.
     * A field nothing reads is how this repo grows orphans, so the field goes
     * with the markup.
     */
    owned: number
  } | null

  /**
   * Time on the server, from THIS console's registry rather than the game's.
   *
   * Deliberately separate from `stats.playtimeMs`: one is how long they were
   * connected, the other is how long they were in a match. A player with twenty
   * hours connected and forty minutes played is a very specific thing, and
   * collapsing the two would hide it.
   */
  connected: {
    sessions: number
    playtimeMs: number
  } | null

  /** Every name they have used, newest first. A rename before an incident is
   *  itself a signal, which is why the history is kept rather than the latest. */
  names: Array<{ name: string; firstSeen: number; lastSeen: number }>

  /** live — only present while they are actually connected. */
  live: {
    src: number
    state: string
    matchId: number | null
    squadId: number | null
    hp: number
    inventory: Array<{ slot: number; item: string | null; count?: number }>
  } | null

  /** moderation — Slice 2+. */
  incidents: ProfileIncident[]
  reportsFiled: ProfileIncident[]
  bans: Array<{
    at: number
    reason: string
    by: string
    liftedAt?: number
    liftedBy?: string
  }>

  /**
   * Kicks and bans taken against them, newest first.
   *
   * FROM THE AUDIT LOG, NOT THE BANS TABLE. That table holds one row per
   * license, so a second ban overwrites the first — the history only exists in
   * the append-only log.
   */
  actions: ProfileAction[]

  /**
   * Per-match history, newest first — REAL SINCE #153.
   *
   * THREE STATES, NOT TWO, and the page renders all three differently:
   *
   *   null   the query failed. Say so; an unreadable table is not an empty one.
   *   []     no per-match rows exist. Read together with `stats`: if the career
   *          totals show matches played, this player's matches all predate the
   *          feature and are only in the totals. If they do not, nobody has
   *          recorded a match for this person at all.
   *   rows   what they played.
   *
   * The middle case is the one that will be common for months and is the
   * easiest to get wrong: a long-standing player must not be shown the same
   * blank panel as somebody who has never connected.
   */
  matches: ProfileMatch[] | null
}

/*
 * demoProfile() USED TO LIVE HERE, and it is gone rather than deprecated.
 *
 * It existed to give this page something to render before the streams behind
 * it were real, and it was honest about being fabricated. But its only caller
 * was the profile page, every field it invented now has a genuine source, and
 * a fixture that produces a plausible Profile is a loaded gun in a repo where
 * the thing being faked is a record a moderator acts on. Deleting it means
 * there is no longer any code path that can put an invented anticheat
 * escalation on a real person's page.
 *
 * If a design harness needs one again, it should live under a test directory
 * and be impossible to import from src/app.
 */
