import { ddb, tables } from './dynamo'

/**
 * The player registry: everyone this server has ever seen.
 *
 * KEYED ON LICENSE, like bans, grants and audit. It is the identifier the game
 * can produce at connect and the only one every other table already agrees on.
 *
 * WHAT LIVES HERE AND WHAT DOES NOT. This holds identity and history — who
 * they are, what they have called themselves, when they play. It deliberately
 * does NOT hold their inventory: purchases are load-bearing game state that
 * gets granted back on join, so they live in their own item where a stats
 * write cannot clobber them and the game's join-time read stays small.
 *
 * THERE IS NO IP ADDRESS ANYWHERE and there never will be. The game side
 * filters it out by allowlist rather than denylist (br_lib/shared/identity.lua),
 * so an identifier type FiveM adds next year is excluded by construction rather
 * than collected by default.
 */

/** Identifier kinds the game collects. `ip` is excluded by construction. */
export type IdKind = 'license' | 'license2' | 'discord' | 'steam' | 'fivem' | 'xbl' | 'live'

/**
 * One identifier this player has presented, with when we saw it.
 *
 * A LIST PER KIND, NOT ONE VALUE. People change Discord accounts, and the
 * whole point of keeping identity history is being able to see that they did.
 * Overwriting would destroy exactly the fact worth having.
 */
export interface IdentifierSighting {
  value: string
  firstSeen: number
  lastSeen: number
}

export interface PlayerRecord {
  /** Partition key. The qualified license. */
  license: string

  /** Most recent in-game name. */
  name: string
  /**
   * Every name they have used, newest first.
   *
   * Kept because "who is this" is often answered by a name somebody remembers
   * from three weeks ago, and because a name change right before an incident
   * is itself a signal.
   */
  names: Array<{ name: string; firstSeen: number; lastSeen: number }>
  /** Set from the pause menu. Distinct from the name FiveM reports. */
  preferredName?: string | null

  /** kind -> every value seen for it. */
  identifiers: Partial<Record<IdKind, IdentifierSighting[]>>

  firstSeen: number
  lastSeen: number

  /** Completed sessions. Updated when they disconnect. */
  sessions: number
  /** Total connected time across all sessions, ms. */
  playtimeMs: number
  /** The current session's start, when connected. Cleared on disconnect. */
  sessionStartedAt?: number | null

  /**
   * Match statistics.
   *
   * NULL UNTIL M7B WRITES IT. These arrive at match end from br_stats, which
   * is still on MariaDB. The field exists so the shape is settled, and the UI
   * says "not recorded yet" rather than rendering zeros that read as "this
   * player has never won anything".
   */
  stats?: {
    matches: number
    wins: number
    kills: number
    deaths: number
    damageDealt: number
    soloMatches: number
    squadMatches: number
  } | null

  /**
   * Licenses they most often squad with, most frequent first.
   *
   * Also M7b: it needs squad composition at match end, which nothing records
   * yet.
   */
  partyWith?: Array<{ license: string; name: string; matches: number }> | null

  /** M7b. Progression, written at match end alongside stats. */
  xp?: number | null
  level?: number | null
}

/**
 * The reverse index: identifier -> license.
 *
 * WHY IT HAS TO EXIST SEPARATELY. The mismatched-identifier check asks "has
 * this Discord account been here under a DIFFERENT license before" — and a
 * table keyed on license cannot answer that, because a new license is simply a
 * new row with nothing to compare against. The question only has an answer
 * from the other direction.
 *
 * Partition key is `id` — the qualified identifier, e.g. `discord:280…`. One
 * row per identifier, pointing at every license that has presented it.
 */
export interface IdentifierIndexRow {
  /** Partition key: the qualified identifier. */
  id: string
  /** Licenses that have presented it, most recent last. */
  licenses: string[]
  firstSeen: number
  lastSeen: number
}

export async function playerFor(license: string): Promise<PlayerRecord | null> {
  const res = await ddb.get({ TableName: tables.players, Key: { license } })
  return (res.Item as PlayerRecord | undefined) ?? null
}

/** Which licenses have used this identifier before? */
export async function licensesFor(qualifiedId: string): Promise<string[]> {
  const res = await ddb.get({
    TableName: tables.playerIds,
    Key: { id: qualifiedId },
  })
  return (res.Item as IdentifierIndexRow | undefined)?.licenses ?? []
}

/** Merge a sighting into a list, keeping first/last seen honest. */
function mergeSighting(
  list: IdentifierSighting[] | undefined,
  value: string,
  now: number,
): IdentifierSighting[] {
  const rows = list ? [...list] : []
  const found = rows.find((r) => r.value === value)
  if (found) {
    found.lastSeen = now
    return rows
  }
  rows.push({ value, firstSeen: now, lastSeen: now })
  return rows
}

/**
 * Record a connect: identifiers, name, and the start of a session.
 *
 * RETURNS WHAT CHANGED, because the interesting output is not the write but
 * the observation: a Discord account that used to belong to somebody else, or
 * a license that has never been seen. Those are what the mismatch incident is
 * built from, and computing them here means the caller does not re-read the
 * row to work them out.
 */
export async function recordConnect(input: {
  license: string
  name: string
  identifiers: Partial<Record<IdKind, string>>
  now: number
}): Promise<{
  isNew: boolean
  record: PlayerRecord
  /** Identifiers that previously belonged to a DIFFERENT license. */
  sharedWith: Array<{ kind: IdKind; value: string; licenses: string[] }>
}> {
  const { license, name, identifiers, now } = input
  const existing = await playerFor(license)

  // Look for identifiers already claimed by somebody else, BEFORE writing our
  // own — otherwise we would find ourselves in the index and report a match
  // against the license we are currently recording.
  const sharedWith: Array<{ kind: IdKind; value: string; licenses: string[] }> = []
  for (const [kind, value] of Object.entries(identifiers) as Array<[IdKind, string]>) {
    if (!value || kind === 'license') continue
    const qualified = `${kind}:${value}`
    const owners = await licensesFor(qualified)
    const others = owners.filter((l) => l !== license)
    if (others.length > 0) {
      sharedWith.push({ kind, value, licenses: others })
    }
  }

  const record: PlayerRecord = existing ?? {
    license,
    name,
    names: [],
    identifiers: {},
    firstSeen: now,
    lastSeen: now,
    sessions: 0,
    playtimeMs: 0,
    stats: null,
  }

  record.name = name || record.name
  record.lastSeen = now
  record.sessionStartedAt = now

  const nameRow = record.names.find((n) => n.name === name)
  if (nameRow) {
    nameRow.lastSeen = now
  } else if (name) {
    record.names.unshift({ name, firstSeen: now, lastSeen: now })
  }

  for (const [kind, value] of Object.entries(identifiers) as Array<[IdKind, string]>) {
    if (!value) continue
    record.identifiers[kind] = mergeSighting(record.identifiers[kind], value, now)
  }

  await ddb.put({ TableName: tables.players, Item: record })

  // Update the reverse index after the player row, so a crash between the two
  // leaves an index entry missing rather than one pointing at a player that
  // was never written.
  for (const [kind, value] of Object.entries(identifiers) as Array<[IdKind, string]>) {
    if (!value || kind === 'license') continue
    const id = `${kind}:${value}`
    await ddb
      .update({
        TableName: tables.playerIds,
        Key: { id },
        UpdateExpression:
          'SET licenses = list_append(if_not_exists(licenses, :empty), :l), lastSeen = :n, firstSeen = if_not_exists(firstSeen, :n)',
        // A conditional keeps the list from growing on every reconnect: only
        // append a license this identifier has not already been linked to.
        ConditionExpression: 'attribute_not_exists(licenses) OR NOT contains(licenses, :one)',
        ExpressionAttributeValues: {
          ':empty': [] as string[],
          ':l': [license],
          ':one': license,
          ':n': now,
        },
      })
      .catch(() => {
        /* condition failed = already linked, which is the common case */
      })
  }

  return { isNew: existing === null, record, sharedWith }
}

/**
 * Close out a session on disconnect.
 *
 * PLAYTIME IS ACCUMULATED HERE rather than derived from first/last seen,
 * because those span every gap between sessions — somebody who played an hour
 * a year ago and an hour today has two hours of playtime, not a year.
 */
export async function recordDisconnect(
  license: string,
  now: number,
): Promise<void> {
  const rec = await playerFor(license)
  if (!rec) return

  const started = rec.sessionStartedAt
  // Guard against a clock that went backwards and against a session left open
  // by a console restart, which would otherwise book days of playtime.
  const MAX_SESSION_MS = 12 * 60 * 60 * 1000
  const length =
    started && now > started && now - started < MAX_SESSION_MS ? now - started : 0

  await ddb
    .update({
      TableName: tables.players,
      Key: { license },
      UpdateExpression:
        'SET playtimeMs = if_not_exists(playtimeMs, :z) + :d, sessions = if_not_exists(sessions, :z) + :one, lastSeen = :n, sessionStartedAt = :null',
      ExpressionAttributeValues: {
        ':d': length,
        ':one': length > 0 ? 1 : 0,
        ':z': 0,
        ':n': now,
        ':null': null,
      },
    })
    .catch(() => {})
}

/** Record a preferred name set from the pause menu. */
export async function setPreferredName(
  license: string,
  preferredName: string,
): Promise<void> {
  await ddb
    .update({
      TableName: tables.players,
      Key: { license },
      ConditionExpression: 'attribute_exists(license)',
      UpdateExpression: 'SET preferredName = :p',
      ExpressionAttributeValues: { ':p': preferredName },
    })
    .catch(() => {})
}

/**
 * Search the registry by name or identifier.
 *
 * A SCAN, and honestly so. DynamoDB cannot search substrings without a
 * different store, and at this scale (a few thousand lifetime players, a
 * handful of admin searches a day) a scan costs a few hundred kilobytes on a
 * page nobody opens in a loop. When it stops being fine the answer is
 * OpenSearch or a name-prefix GSI, not a cleverer scan.
 */
export async function search(query: string, limit = 10): Promise<PlayerRecord[]> {
  const q = query.trim().toLowerCase()
  const res = await ddb.scan({ TableName: tables.players, Limit: 500 })
  const rows = (res.Items ?? []) as PlayerRecord[]

  const matched = q
    ? rows.filter(
        (r) =>
          r.name?.toLowerCase().includes(q) ||
          r.license.toLowerCase().includes(q) ||
          r.preferredName?.toLowerCase().includes(q) ||
          r.names?.some((n) => n.name.toLowerCase().includes(q)) ||
          Object.values(r.identifiers ?? {}).some((list) =>
            list?.some((s) => s.value.toLowerCase().includes(q)),
          ),
      )
    : rows

  return matched.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit)
}

/**
 * The Discord avatar URL for a player, if we know their Discord id.
 *
 * BUILT FROM THE ID RATHER THAN STORED. Discord's CDN needs the avatar HASH,
 * which we never receive from the game — only the user id. So this returns the
 * default-avatar endpoint, which is deterministic from the id and never 404s.
 * A real avatar needs a Discord API call with a bot token, which is a decision
 * about adding a credential rather than a display detail.
 */
export function discordAvatar(discordId: string | null | undefined): string | null {
  if (!discordId) return null
  // Discord's own fallback: (id >> 22) % 6 for the new username system.
  let index = 0
  try {
    index = Number((BigInt(discordId) >> 22n) % 6n)
  } catch {
    return null
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}
