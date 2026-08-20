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

import type { IncidentVerdict, VerdictAction } from './incidents'

import type { AccentSurface } from './contrast'

export type Provenance = 'live' | 'identity' | 'stats' | 'moderation'

/*
 * `AdminRole` USED TO BE HERE — a four-state union (`yes` / `no` / `unknown` /
 * `unchecked`) carrying HOW SURE the console was that somebody holds the Discord
 * admin role. It is gone, and `DiscordChrome.admin` is a boolean.
 *
 * WHY IT EXISTED. `unknown` — a timeout, a 429, a 5xx, a guild the bot cannot
 * see — wore a quiet `ADMIN?` chip, so a red ADMIN could never vanish merely
 * because Discord was slow. `unchecked` (no bot token) rendered nothing, being a
 * configuration state rather than an event.
 *
 * WHY IT IS GONE. The owner: "Change ADMIN? to just show nothing". With that,
 * three of the four states render identically and no reader anywhere can tell
 * them apart — a four-valued type with a one-bit consumer is the dead-code shape
 * this repo keeps shipping (`posSampleHz` with no readers, `left` with no
 * writer). So it collapsed to the one bit that is actually read.
 *
 * WHAT DID NOT COLLAPSE. `RoleCheck` in lib/discordRole.ts still carries all
 * three states and its `why`, because the WRITE gate genuinely distinguishes
 * them: `revoked` denies and ends the session, `unresolved` fails open, and the
 * two write different audit rows (`discord.revoked`, `discord.unresolved`). That
 * distinction is real, tested by `check:discordrole`, and untouched. Only the
 * page's view of it was ever four-valued.
 *
 * WHAT AN OPERATOR NOW SEES WHEN DISCORD IS DOWN, stated plainly because it is a
 * real consequence and nothing else records it: a genuine admin's profile looks
 * exactly like a non-admin's. No chip, no marker, and — unlike the write path —
 * no audit row, because opening a profile is a read and reads are not events.
 * The page does not wait longer to be sure; see `adminHoldsRole` in lib/discord.
 */

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

  /**
   * TRUE ONLY WHEN DISCORD ANSWERED AND THE ADMIN ROLE IS HELD.
   *
   * FALSE IS FOUR DIFFERENT THINGS and this field cannot tell them apart, by
   * decision rather than by accident: Discord said no, Discord did not answer,
   * there is no bot token, or the account has no Discord id at all. See the note
   * where `AdminRole` used to be, above, for what that costs and why the owner
   * asked for it.
   *
   * IT RIDES ON THE CHROME BECAUSE IT IS THE SAME FACT FROM THE SAME PLACE, and
   * because of what that buys: the whole profile already waits behind one
   * skeleton for Discord, so the chip arrives in the same instant as the face and
   * the banner rather than popping in afterwards — which is requirement 3 of
   * components/DiscordChrome ("nothing pops in late"). A second promise with a
   * second provider would be a second wait with nothing keeping the two in step.
   *
   * IT COSTS NO EXTRA WALL TIME. `discordChromeFor` runs the role check in
   * PARALLEL with `GET /users/{id}` under the same budget, so the page's worst
   * case is the max of the two rather than their sum — unchanged from before this
   * field existed, and unchanged by the collapse above. Rendering nothing did NOT
   * become "wait longer to be sure".
   */
  admin: boolean
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
   * What was decided, when anybody decided anything (#28).
   *
   * IMPORTED RATHER THAN RESPELLED, unlike `state` above. `state` is two string
   * literals that have not moved since the module was written; a verdict is a
   * discriminated union that another repository reads to decide whether to pay
   * somebody 250 Volts, and a hand-copy of it here would be a third spelling of
   * a shape that already has two. The import is `import type`, so it erases and
   * nothing drags `lib/incidents` — which reaches DynamoDB — into a client
   * bundle.
   *
   * NULL AND ABSENT MEAN "NOBODY RECORDED ONE", NOT "NO ACTION". Everything
   * closed before #28, and everything the system auto-resolved, arrives here
   * with nothing — and the row must say so rather than inventing a decision. See
   * {@link IncidentVerdict}.
   */
  verdict?: IncidentVerdict | null
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

/**
 * One moderation action this person TOOK, as opposed to one taken against them.
 *
 * THE OTHER DIRECTION THROUGH THE SAME TABLE. `ProfileAction` above is the audit
 * log filtered on `targetLicense`; this is the same log filtered on
 * `actorLicense`. They are different questions about the same person and the
 * profile page now asks both — "what has been done to them" and, for the people
 * who are admins, "what have they done".
 *
 * IT IS ONE ROW PER ACT, NOT ONE ROW PER AUDIT ROW, and that is the whole reason
 * this shape exists rather than reusing `AuditRow`. A ban issued as an incident
 * verdict writes TWO rows on purpose (`ban.issue` and `incident.resolve`, sharing
 * an `incidentId`), and a ban against somebody who is online writes a third (the
 * `player.kick` that enforces it). Listing the log raw shows one decision as
 * three lines. See lib/actionsTaken.ts, which does the collapsing.
 */
export interface ProfileActionTaken {
  at: number
  /**
   * The audit action this row IS, after collapsing — `ban.issue`, `ban.lift`,
   * `player.kick` or `incident.resolve`. Never the row that was folded into it.
   */
  action: string
  outcome: string
  /** Who it was done to. Null only for a row the log recorded without one. */
  targetName: string | null
  /** Links to their profile, when we have a license. */
  targetLicense: string | null
  reason: string | null
  /** The incident it was decided on, when it was decided on one. */
  incidentId: string | null
  /**
   * What the incident recorded as the outcome, when there was an incident.
   *
   * ONLY RENDERED WHEN NO ACTION ROW WAS FOLDED IN. On a collapsed ban-from-an-
   * incident the row's own label already reads "Banned", and a `banned` chip
   * beside it would be the same word twice — which is the duplication this whole
   * module exists to remove, reintroduced one line lower.
   */
  verdict: VerdictAction | null
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
  /**
   * THE BAN ROW FOR THIS LICENSE, OR NULL. One, or none — never a list.
   *
   * IT WAS AN ARRAY AND THE ARRAY WAS A LIE. The bans table is keyed on license
   * and a second ban OVERWRITES the first, so this could only ever hold zero or
   * one row — but shaped as a list it invited a count, and the identity bar duly
   * rendered "1 BAN" beside the player's name for anybody with a row, INCLUDING
   * one that was lifted or long served. A player in good standing wore a red
   * chip that read like a rap sheet and could never say anything but 1. The
   * owner asked for the count to go; the shape that produced it goes with it.
   *
   * IT IS THE CURRENT ROW, NOT A HISTORY, AND IT IS NOT THE SAME QUESTION AS
   * "IS THIS PLAYER BANNED". Whether it is in force is decided once, by
   * `bans.isActive`, on the server — see the `banned` prop on ProfileView. This
   * is what the chip SAYS when it is; the history of every ban and lift lives in
   * `actions`, from the append-only audit log.
   */
  ban: {
    at: number
    reason: string
    /** The issuing admin's display name at the time. */
    by: string
    /**
     * Their license, when we have one, so the card can link to their profile
     * the way the audit log links both parties. Null for a system-issued ban,
     * and for an admin whose record has since gone.
     */
    byLicense: string | null
    /** Absolute, or null for permanent. Never a duration; see lib/bans. */
    expiresAt: number | null
  } | null

  /**
   * Kicks and bans taken against them, newest first.
   *
   * FROM THE AUDIT LOG, NOT THE BANS TABLE. That table holds one row per
   * license, so a second ban overwrites the first — the history only exists in
   * the append-only log.
   */
  actions: ProfileAction[]

  /**
   * Moderation actions THIS person took, newest first, one row per act.
   *
   * SAME LOG, OTHER DIRECTION. `actions` above is `targetLicense === license`;
   * this is `actorLicense === license`, collapsed by `actionsTakenFrom` so a ban
   * issued as an incident verdict is one row rather than two. Empty for the
   * overwhelming majority of profiles, which is exactly what it should be — see
   * ProfileView for when the panel renders at all.
   */
  actionsTaken: ProfileActionTaken[]

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
