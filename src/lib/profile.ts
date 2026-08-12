/**
 * A player's full record.
 *
 * MOST OF THIS IS REAL NOW. The two that are not — incidents and per-match
 * session history — have no stream behind them at all, and they render as
 * absent rather than as empty-but-plausible. That distinction is load-bearing
 * on a page a moderator acts on.
 *
 * The provenance matters because these come from five different places with
 * five different freshness and trust properties:
 *
 *   live       the current snapshot. Two seconds old at worst, gone on restart.
 *   identity   ringmaster-players, this console's registry. Durable.
 *   stats      br-players, written by the GAME at match end. Durable, and not
 *              writable from here — Ringmaster only reads it.
 *   moderation Ringmaster's own tables — bans, audit.
 *   (nothing)  incidents and match history. No source yet; always empty.
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
  kind: 'anticheat' | 'report'
  at: number
  summary: string
  /** Open incidents are what the nav badge counts. */
  state: 'open' | 'reviewed' | 'actioned' | 'dismissed'
  /** For reports: who filed it. Absent for anticheat escalations. */
  reportedBy?: string
}

export interface ProfileSession {
  at: number
  durationMs: number
  matchId: number | null
  placement: number | null
  kills: number
}

export interface Profile {
  license: string
  name: string

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

  /** Per-match history. NOTHING RECORDS THIS YET — it renders as absent. */
  recentSessions: ProfileSession[]
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
