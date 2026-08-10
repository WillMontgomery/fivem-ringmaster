/**
 * A player's full record.
 *
 * ALMOST NONE OF THIS EXISTS YET, and pretending otherwise would be the worst
 * thing this file could do. Each field below is annotated with where it will
 * really come from, so the profile page can be designed against the shape it
 * will have rather than the shape that is convenient today — and so nobody
 * later mistakes a demo for a feature.
 *
 * The provenance matters because these come from four different places with
 * four different freshness and trust properties:
 *
 *   live      the current snapshot. Two seconds old at worst, gone on restart.
 *   identity  the `player_seen` event stream. Durable, appended on connect.
 *   stats     br_stats / DynamoDB (M7b). Durable, written at match end.
 *   moderation Ringmaster's own tables — bans, incidents, audit (Slice 2+).
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

  /** stats — M7b. Absent until that lands, and the UI must survive that. */
  stats: {
    matches: number
    wins: number
    kills: number
    deaths: number
    damageDealt: number
    playtimeMs: number
  } | null

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

  recentSessions: ProfileSession[]
}

/**
 * Demo data for the design harness.
 *
 * Deterministic, derived from the license so two different players look
 * different and the same player looks the same twice. Everything here is
 * FABRICATED and the page says so on screen — a profile page that silently
 * invents an inventory is how a moderator ends up acting on nothing.
 */
export function demoProfile(license: string, name: string): Profile {
  let h = 0
  for (let i = 0; i < license.length; i++) h = (h * 31 + license.charCodeAt(i)) >>> 0
  const pick = (n: number, salt: number) => ((h >> salt) % n + n) % n

  const now = 1_754_784_000_000
  const day = 86_400_000

  return {
    license,
    name,
    identifiers: [
      { kind: 'license', value: license.replace('license:', ''), firstSeen: now - 47 * day },
      { kind: 'discord', value: `99887766554433${pick(90, 3) + 10}`, firstSeen: now - 47 * day },
      { kind: 'steam', value: `1100001${(10000000 + pick(9000000, 5)).toString()}`, firstSeen: now - 47 * day },
    ],
    firstSeen: now - (30 + pick(300, 2)) * day,
    lastSeen: now - pick(60, 7) * 60_000,
    stats: {
      matches: 40 + pick(300, 4),
      wins: pick(30, 6),
      kills: 100 + pick(900, 8),
      deaths: 40 + pick(300, 9),
      damageDealt: 20_000 + pick(200_000, 10),
      playtimeMs: (8 + pick(200, 11)) * 3_600_000,
    },
    live: null,
    incidents:
      pick(3, 12) === 0
        ? [
            {
              id: 'inc_8f21',
              kind: 'anticheat',
              at: now - 2 * day,
              summary: '8 refusals in 10s — TOO_FAR ×6, NO_AMMO ×2',
              state: 'open',
            },
          ]
        : [],
    reportsFiled:
      pick(4, 13) === 0
        ? [
            {
              id: 'inc_1a90',
              kind: 'report',
              at: now - 5 * day,
              summary: 'Reported "kettle" — shooting through walls',
              state: 'dismissed',
              reportedBy: license,
            },
          ]
        : [],
    bans: [],
    recentSessions: Array.from({ length: 6 }, (_, i) => ({
      at: now - (i + 1) * day * (1 + pick(2, i)),
      durationMs: (20 + pick(90, i + 2)) * 60_000,
      matchId: 40 - i,
      placement: pick(20, i + 3) + 1,
      kills: pick(8, i + 4),
    })),
  }
}
