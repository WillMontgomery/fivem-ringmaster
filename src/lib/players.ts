import { ddb, tables } from './dynamo'
import type { DiscordNameChange } from './profile'

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

/**
 * What Discord called this player, and what it used to call them.
 *
 * THE ONLY DISCORD DATA THIS CONSOLE STORES, and the reason it is stored is the
 * reason nothing else is. Avatar, banner and accent colour are fetched live on
 * every profile render, because a stale answer to "what do they look like now"
 * is simply the wrong answer. Names are not like that: `GET /users/{id}`
 * returns the present and nothing else, so calling it a thousand times still
 * cannot tell you that somebody used to be called something different. If
 * Ringmaster does not write it down at the moment it notices, the fact does not
 * exist anywhere.
 *
 * AND IT IS A MODERATION FACT. Renaming is the ordinary thing a reported player
 * does next, and the registry already keeps in-game name history for exactly
 * that reason (see `names` below). This is the same idea applied to the
 * identity a human actually recognises them by.
 *
 * THE ID IS STORED TOO, and not redundantly. `identifiers.discord` holds every
 * Discord id this license has ever presented; this holds the one these names
 * belong to. When somebody switches Discord accounts the names do not continue
 * a history, they start a new one, and comparing ids is how that is noticed
 * rather than silently recorded as a rename.
 */
export interface DiscordIdentity {
  /** The Discord user id these names were read from. */
  id: string
  /** The @handle, as of `changedAt`. */
  username: string | null
  /** The display name, as of `changedAt`. */
  globalName: string | null
  /** Superseded names, newest first. Capped — see DISCORD_NAME_HISTORY. */
  former: DiscordNameChange[]
  /** When Ringmaster first recorded a Discord identity for this license. */
  firstSeen: number
  /**
   * When these names were last WRITTEN, which is not when they were last SEEN.
   *
   * Named for what it is. A profile render that finds nothing changed does not
   * write, so this does not tick on every page view — and a field called
   * `lastSeen` that only moves on a change would be a small lie of exactly the
   * kind this file has already had to remove once.
   */
  changedAt: number
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

  /**
   * Their Discord names, and the ones they used to have.
   *
   * Written by the profile page when it fetches Discord, not by the game — the
   * game never talks to Discord and has no reason to. Absent for every player
   * whose profile has not been opened since the token was configured, which is
   * a real and readable state rather than a bug.
   */
  discord?: DiscordIdentity | null
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

/**
 * How many superseded Discord names one player keeps.
 *
 * A CAP, BECAUSE THIS LIST IS APPEND-ONLY AND THE INPUT IS A STRANGER. Discord
 * display names can be changed as often as somebody likes, and a player who
 * enjoys doing it would otherwise grow one DynamoDB item without bound until it
 * hit the 400KB limit and every write to that row started failing — taking the
 * session and playtime accounting with it, which is a much worse outcome than
 * losing the twenty-first oldest nickname.
 *
 * Twenty is far past the point of usefulness for the question this answers
 * ("what were they called around the time of the incident") and far short of
 * anything that threatens the item.
 */
const DISCORD_NAME_HISTORY = 20

/**
 * Reconcile a live Discord answer against what we last stored.
 *
 * RETURNS THE MERGED IDENTITY WHETHER OR NOT IT WROTE, so the caller can render
 * the current history rather than the one from before this render — the change
 * that was just noticed is the one most worth showing.
 *
 * IT ONLY WRITES WHEN SOMETHING MOVED. A profile page is opened repeatedly and
 * names change approximately never, so the ordinary render is a comparison and
 * no DynamoDB call at all. Without that check this would be a write per page
 * view, on a table the game also writes, for nothing.
 *
 * A NEW DISCORD ACCOUNT IS NOT A RENAME. When the id differs from the stored
 * one the history is reset rather than continued: those names belonged to a
 * different account, and stitching them together would manufacture a "formerly
 * known as" that never happened. The old ids are still visible — the identifier
 * list keeps every Discord id this license has presented — so nothing is lost,
 * it is just not misattributed.
 *
 * THE WRITE IS CONDITIONAL ON THE ROW EXISTING. Viewing a profile must never
 * create a registry entry: `players.playerFor` returning null means the game has
 * never seen this license, and a page view is not a sighting.
 */
export async function recordDiscordIdentity(input: {
  license: string
  /** The stored block, already read by the caller. */
  stored: DiscordIdentity | null | undefined
  id: string
  username: string | null
  globalName: string | null
  now: number
}): Promise<DiscordIdentity> {
  const { license, stored, id, username, globalName, now } = input

  const sameAccount = stored?.id === id

  const former: DiscordNameChange[] = sameAccount ? [...(stored?.former ?? [])] : []

  if (sameAccount && stored) {
    // A change FROM nothing is not a change — it is the first time we looked.
    // Only a value being replaced is worth a row.
    if (stored.username && stored.username !== username) {
      former.unshift({ field: 'username', from: stored.username, to: username, at: now })
    }
    if (stored.globalName && stored.globalName !== globalName) {
      former.unshift({ field: 'globalName', from: stored.globalName, to: globalName, at: now })
    }
  }

  const identity: DiscordIdentity = {
    id,
    username,
    globalName,
    former: former.slice(0, DISCORD_NAME_HISTORY),
    firstSeen: sameAccount && stored ? stored.firstSeen : now,
    changedAt: now,
  }

  const unchanged =
    sameAccount &&
    stored != null &&
    stored.username === username &&
    stored.globalName === globalName

  if (unchanged) {
    // Nothing moved. Hand back what is already stored — including its original
    // `changedAt`, because claiming it changed now would be false.
    return stored
  }

  await ddb
    .update({
      TableName: tables.players,
      Key: { license },
      ConditionExpression: 'attribute_exists(license)',
      UpdateExpression: 'SET discord = :d',
      ExpressionAttributeValues: { ':d': identity },
    })
    .catch(() => {
      /* No row, or DynamoDB said no. The page still renders; the history of
         this one change is what is lost, and it will be re-noticed on the next
         view because the stored value has not moved. */
    })

  return identity
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

/*
 * discordAvatar() LIVES IN lib/discord.ts NOW, and has a real implementation.
 *
 * The version that was here could only ever return Discord's GENERIC DEFAULT
 * avatar — one of six coloured logos derived arithmetically from the id —
 * because a real profile picture needs the account's avatar hash and only the
 * Discord API knows it. It was wired into the profile page and presented as
 * showing the player's picture, which it never did.
 *
 * lib/discord.ts asks the API when DISCORD_BOT_TOKEN is set and falls back to
 * that same default when it is not. It does NOT cache the hash, here or
 * anywhere — see the note at the top of that file about the durable copy this
 * module was once said to hold and never did.
 */
