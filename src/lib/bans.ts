import { ddb, tables } from './dynamo'

/**
 * Bans.
 *
 * A BAN IS A RECORD, NOT A DELETION, and lifting one does not remove it. The
 * row keeps `liftedAt` and `liftedBy` and stays exactly where it was, because
 * the question an admin actually asks six months later is "has this person been
 * banned before, and who let them back in" — which a table that deletes on lift
 * cannot answer at all. It also means an accidental lift is recoverable and
 * visible rather than silent.
 *
 * KEYED ON LICENSE because that is the identifier the game server can check at
 * connect time and the one every other table already keys on. Not the Discord
 * id (an admin construct, absent for most players), not a name (changeable),
 * and never an IP — which this system does not collect anywhere, by
 * construction rather than by policy.
 *
 * THE GAME BOX READS THIS TABLE DIRECTLY and holds no copy of its own. It gets
 * a read-only GetItem on exactly this table, which is why "is this license
 * banned" is a single point lookup rather than a query: the game asks about one
 * license at a time, at connect, and nothing else.
 */

export interface Ban {
  /** Partition key. The qualified license, e.g. `license:abc123…`. */
  license: string

  /** When the ban was issued. */
  at: number
  /** The admin who issued it, by license. Null only for system-issued bans. */
  by: string | null
  /** Their display name at the time, so the log reads without a join. */
  byName: string
  /** Why. Shown to the player at connect, so it is written for them. */
  reason: string

  /**
   * When it expires, or null for permanent.
   *
   * An absolute timestamp rather than a duration: a duration would have to be
   * re-evaluated against a moving "now" by every reader, and the game host and
   * the console do not share a clock. One number, one meaning.
   */
  expiresAt: number | null

  /** Player's display name when banned, for the console's list. */
  playerName?: string | null

  /** Set when lifted. Presence of `liftedAt` IS the lifted state. */
  liftedAt?: number | null
  liftedBy?: string | null
  liftedByName?: string | null
  liftReason?: string | null
}

/**
 * Is this ban in force right now?
 *
 * THE ONE PLACE THAT DECIDES, so the console and the connect gate cannot
 * disagree about what "banned" means. Lifted beats everything; an expiry in the
 * past means served.
 */
export function isActive(ban: Ban, now = Date.now()): boolean {
  if (ban.liftedAt) return false
  if (ban.expiresAt !== null && ban.expiresAt <= now) return false
  return true
}

/** The ban row for a license, lifted and expired ones included. */
export async function banFor(license: string): Promise<Ban | null> {
  const res = await ddb.get({
    TableName: tables.bans,
    Key: { license },
  })
  return (res.Item as Ban | undefined) ?? null
}

/** The active ban for a license, or null. What a connect gate asks. */
export async function activeBanFor(license: string): Promise<Ban | null> {
  const ban = await banFor(license)
  return ban && isActive(ban) ? ban : null
}

/**
 * Issue a ban.
 *
 * OVERWRITES ANY EXISTING ROW for that license, which is the correct behaviour
 * for a table keyed on license: re-banning someone who was previously banned
 * and lifted replaces the record with the current one. The history of that
 * player's bans lives in the audit log, which is append-only and is the thing
 * that must never lose a fact.
 */
export async function issue(input: {
  license: string
  by: string | null
  byName: string
  reason: string
  expiresAt: number | null
  playerName?: string | null
}): Promise<Ban> {
  const ban: Ban = {
    license: input.license,
    at: Date.now(),
    by: input.by,
    byName: input.byName,
    reason: input.reason,
    expiresAt: input.expiresAt,
    playerName: input.playerName ?? null,
    liftedAt: null,
    liftedBy: null,
    liftedByName: null,
    liftReason: null,
  }

  await ddb.put({ TableName: tables.bans, Item: ban })
  return ban
}

/**
 * Lift a ban, keeping the row.
 *
 * CONDITIONAL ON THE ROW EXISTING, so lifting a ban that is not there fails
 * loudly instead of writing a lift record for a ban nobody ever issued —
 * which would read, forever after, as though someone had been banned.
 */
export async function lift(input: {
  license: string
  by: string | null
  byName: string
  reason?: string | null
}): Promise<void> {
  await ddb.update({
    TableName: tables.bans,
    Key: { license: input.license },
    ConditionExpression: 'attribute_exists(license)',
    UpdateExpression:
      'SET liftedAt = :t, liftedBy = :b, liftedByName = :n, liftReason = :r',
    ExpressionAttributeValues: {
      ':t': Date.now(),
      ':b': input.by,
      ':n': input.byName,
      ':r': input.reason ?? null,
    },
  })
}

/**
 * Every ban on record.
 *
 * A SCAN, DELIBERATELY. The table is keyed on license with no sort key, so
 * "all bans" has no query form — and at the scale this operates on (a server
 * with a few thousand lifetime players, of whom a small fraction are banned) a
 * scan is a handful of kilobytes. It is called from one admin-facing page, not
 * a hot path. When the table outgrows that, this becomes a GSI on a status
 * attribute; noted so the next person does not have to rediscover why.
 */
export async function all(limit = 500): Promise<Ban[]> {
  const res = await ddb.scan({ TableName: tables.bans, Limit: limit })
  const rows = (res.Items ?? []) as Ban[]

  // Active first, then most recent. The list exists to answer "who is banned",
  // and served or lifted bans are history rather than the answer.
  return rows.sort((a, b) => {
    const aActive = isActive(a)
    const bActive = isActive(b)
    if (aActive !== bActive) return aActive ? -1 : 1
    return b.at - a.at
  })
}
