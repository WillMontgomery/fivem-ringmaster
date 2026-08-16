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

export type Provenance = 'live' | 'identity' | 'stats' | 'moderation'

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
  /** For reports: who filed it. Absent for system-filed incidents. */
  reportedBy?: string
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
  /** Discord CDN avatar, when we have a Discord id for them. */
  avatarUrl?: string | null

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
    /** How many cosmetics they have bought. The list itself is not shown. */
    owned: number
    equipped: Record<string, string>
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
