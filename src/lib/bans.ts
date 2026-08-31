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
 * KEYED ON A QUALIFIED IDENTIFIER, AND ALMOST ALWAYS A LICENSE. This paragraph
 * used to say "keyed on license… not the Discord id (an admin construct, absent
 * for most players)", and that was true of every writer this table had. It is
 * no longer true of all of them, so it is corrected here rather than quietly
 * left standing:
 *
 *   blitz-bot — a third repo, reading and writing this same table — mirrors a
 *   Discord ban into the game. It resolves the target's license through
 *   `ringmaster-player-ids` and keys the row on it, exactly as this file always
 *   has. When that lookup finds NOTHING — somebody banned in Discord whom the
 *   game has never met — it keys the row on `discord:<snowflake>` instead,
 *   because the alternative is either no record at all or a record filed under
 *   a license guessed for them.
 *
 * So a row's partition key is a license in every case but one, and that one
 * case is a PLACEHOLDER: a ban with nobody to apply it to yet. What is still
 * true, and is the reason nothing else changed: not a name (changeable), and
 * never an IP — which this system does not collect anywhere, by construction
 * rather than by policy.
 *
 * THE GAME BOX READS THIS TABLE DIRECTLY and holds no copy of its own. It gets
 * a read-only GetItem on exactly this table — no Query, no Scan — so the connect
 * gate is point lookups on identifiers the connection already presented, and
 * nothing else. Since fivem-ringmaster#38 it is TWO of them rather than one:
 * the license, and the `discord:` identifier FiveM reported for the same
 * connection. Two GetItems, issued together, still no Query. See the gamemode's
 * docs/ban-contract.md.
 *
 * WHICH OF THE TWO ROWS WINS IS `effective` BELOW, and it is the same kind of
 * object as `isActive`: one rule, written once here, hand-copied into
 * js-src/br_ddb/src/ban.js, and guarded by a case table on each side.
 *
 * A PLACEHOLDER IS RECONCILED AWAY BY THIS SIDE, NOT BY THE GAME BOX — see
 * `reconcileDiscordBan`. The game enforces; the console is the only side that
 * writes.
 */

export interface Ban {
  /**
   * Partition key. A qualified identifier — `license:abc123…` for everyone the
   * game has met, and `discord:280…` for the placeholder case in the header.
   *
   * THE ATTRIBUTE KEEPS THE NAME `license` WHATEVER IS IN IT. Renaming it would
   * be a table migration across three repos to make one field read better in
   * the one case out of many where it holds something else.
   */
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

  /**
   * The Discord audit-log entry this ban was mirrored from.
   *
   * WRITTEN BY blitz-bot, NOT BY THIS FILE, and declared here only because
   * `reconcileDiscordBan` has to carry it across. Nothing on this side reads it
   * to make a decision.
   *
   * IT IS LOAD-BEARING FOR THE UNBAN PATH, which is the whole reason
   * reconciliation copies it rather than dropping it. The bot's `liftableBy`
   * lifts a row only when this attribute is present and names an entry no newer
   * than the unban being processed — that is what stops a Discord unban
   * evaporating a cheating ban the console issued. A reconciled row that lost
   * this marker would be a ban no Discord unban could ever lift again.
   */
  discordEntryId?: string | null

  /**
   * The placeholder key this row was reconciled from, e.g. `discord:280…`.
   *
   * PROVENANCE, AND THE ONLY TRACE THE PLACEHOLDER LEAVES. The placeholder row
   * is deleted once its ban lands on a license (the owner's ruling; see
   * `reconcileDiscordBan`), so without this the reconciled ban would look like
   * an ordinary console ban issued by somebody with a Discord name. It is data,
   * not a decision: nothing branches on it.
   */
  reconciledFrom?: string | null
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

/**
 * Given every ban row a connection's identifiers turned up, which one applies?
 *
 * THE SECOND HALF OF "THE ONE PLACE THAT DECIDES", AND IT EXISTS BECAUSE THERE
 * ARE NOW TWO ROWS TO ASK ABOUT. `isActive` answers "is this row in force",
 * which was the whole question while the gate looked up one key. It looks up
 * two, and "banned" stopped being a property of a row and became a property of
 * a PERSON — so the rule that turns several rows into one answer has to live
 * somewhere, and putting it anywhere else would be the second opinion this
 * file's whole design is against.
 *
 * THE OWNER'S RULING, SETTLED: an ACTIVE ban always takes precedence over a
 * lifted one. The case that forced it is real and is not exotic — an admin
 * lifts somebody's old license ban, a Discord ban lands on them afterwards, and
 * a rule that preferred the license row by kind would read the lift and open
 * the door. So the rule does not look at the KIND of identifier at all: the
 * first row that is in force wins, and a row that is not in force never beats
 * one that is.
 *
 * THE ORDER OF `rows` IS THE TIE-BREAK, AND THE CALLER OWNS IT. When two rows
 * are both in force the player is refused either way, so the only thing the
 * order decides is which `reason` they are shown. Callers pass the LICENSE row
 * first, because that is the row the console's own profile page renders — so
 * the sentence on the connecting screen is the sentence the admin is looking
 * at. `null` and `undefined` are skipped, so a caller that found nothing on one
 * identifier passes the gap through rather than branching around it.
 *
 * DUPLICATED IN js-src/br_ddb/src/ban.js, deliberately, exactly like
 * `isActive`. The gamemode's docs/ban-contract.md is the written rule and both
 * sides carry a case table over it.
 */
export function effective(
  rows: ReadonlyArray<Ban | null | undefined>,
  now = Date.now(),
): Ban | null {
  for (const row of rows) {
    if (row && isActive(row, now)) return row
  }
  return null
}

/**
 * The ban row for a qualified identifier, lifted and expired ones included.
 *
 * THE PARAMETER IS NAMED `license` BECAUSE THE ATTRIBUTE IS, and a `discord:`
 * key is a perfectly ordinary argument here — this is a point lookup and it does
 * not care what kind of identifier it was handed.
 */
export async function banFor(license: string): Promise<Ban | null> {
  const res = await ddb.get({
    TableName: tables.bans,
    Key: { license },
  })
  return (res.Item as Ban | undefined) ?? null
}

/**
 * The active ban for one identifier, or null.
 *
 * WHAT THE CONSOLE'S OWN PAGES ASK, and no longer the whole of what the connect
 * gate asks — that reads two keys and reconciles them with `effective`. The
 * profile and incident pages have a license in hand and one question about it,
 * which is what this is for.
 */
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
 * What one reconciliation attempt did. Returned rather than logged so a caller
 * can be tested without matching on log text.
 */
export type ReconcileOutcome =
  /** No `discord:` row for this account. The overwhelmingly common case. */
  | 'no-placeholder'
  /** There is a row, but it is lifted or served. A record, needing no door. */
  | 'not-active'
  /** The license already carries a ban in force. Nothing moved; see below. */
  | 'deferred'
  /** The ban now lives on the license and the placeholder is gone. */
  | 'reconciled'
  /** Somebody wrote to one of the two rows between our read and our write. */
  | 'conflict'

/**
 * The three DynamoDB calls reconciliation makes, as a seam.
 *
 * A SEAM SO THE DECISION CAN BE TESTED OFFLINE, which is the same shape
 * `HandoffStore` in lib/handoff.ts uses and for the same reason: the ordering,
 * the guards and "what happens when the license already carries a live ban" are
 * the interesting part, and none of it should need an AWS account to exercise.
 * `bans.check.ts` drives this with a fake that reproduces the conditional
 * semantics, including a write landing in the gap between our read and ours.
 *
 * `put` AND `remove` CARRY THEIR GUARD RATHER THAN TAKING AN EXPRESSION. A store
 * that accepted a raw `ConditionExpression` would let the fake and the real one
 * disagree about what the condition MEANS, which is exactly the drift a seam is
 * supposed to remove.
 */
export interface BanStore {
  get(id: string): Promise<Ban | null>
  /**
   * @param guard `'absent'` for "create, do not replace"; otherwise the `at` the
   *              row must still carry. Rejects with a
   *              `ConditionalCheckFailedException`-named error when it does not.
   */
  put(ban: Ban, guard: 'absent' | { at: number }): Promise<void>
  remove(id: string, guard: { at: number }): Promise<void>
}

/** The real one. */
export const liveBanStore: BanStore = {
  get: banFor,

  put(ban, guard) {
    return ddb
      .put({
        TableName: tables.bans,
        Item: ban,
        ...(guard === 'absent'
          ? { ConditionExpression: 'attribute_not_exists(license)' }
          : {
              ConditionExpression: 'at = :seenAt',
              ExpressionAttributeValues: { ':seenAt': guard.at },
            }),
      })
      .then(() => undefined)
  },

  remove(id, guard) {
    return ddb
      .delete({
        TableName: tables.bans,
        Key: { license: id },
        ConditionExpression: 'at = :seenAt',
        ExpressionAttributeValues: { ':seenAt': guard.at },
      })
      .then(() => undefined)
  },
}

/**
 * Move a Discord-keyed placeholder ban onto the license it turns out to belong
 * to, and delete the placeholder.
 *
 * ═══ WHAT A PLACEHOLDER IS AND WHY IT CANNOT STAY ═══
 *
 * blitz-bot writes a ban keyed `discord:<snowflake>` when it cannot find a
 * license for the person an admin banned in Discord — see this file's header.
 * The gamemode's connect gate now READS that key, so the ban is enforced from
 * the moment it is written; this function is not what makes it work.
 *
 * What it does is end the placeholder's life. A `discord:`-keyed row is a
 * second-class record in every way that matters to a human: the console's
 * moderation list links it to `/players/discord:280…`, which resolves to
 * nothing; it carries a Discord display name where every other row carries a
 * player name; and it is only enforceable at all while FiveM reports a
 * `discord:` identifier for the connection, which is opt-in on the player's
 * side and therefore evadable by switching it off. The license is the
 * identifier this whole system is built on. As soon as we know it, the ban
 * belongs there.
 *
 * ═══ WHY THE CONSOLE DOES THIS AND NOT THE GAME BOX ═══
 *
 * The owner's ruling, and it agrees with every line of the IAM policy. The game
 * box has `GetItem` on `ringmaster-bans` and no write of any kind — the whole
 * argument in the gamemode's docs/ban-contract.md is that a compromised game
 * host must not be able to alter who is banned. Reconciliation is a write, two
 * writes in fact, one of them a DELETE. It happens on the side that already
 * owns this table.
 *
 * ═══ WHEN IT RUNS ═══
 *
 * On `player_seen`, from the ingest endpoint — the event the game emits with a
 * connection's identifiers on it. That event IS the discord→license mapping,
 * which is why nothing here reads `ringmaster-player-ids`: the answer arrived
 * in the request.
 *
 * AND IT FIRES FOR A REFUSED CONNECTION, which is the property the whole design
 * rests on. br_ringmaster's `capture` and its ban gate are both handlers on
 * `playerConnecting`; capture runs synchronously, emits `player_seen`, and does
 * not care that the gate is about to refuse the same connection. So a banned
 * stranger's FIRST attempt to join — the one the gate turns away — is also the
 * one that teaches this side who they are. They are refused at the door and
 * reconciled behind it, in that order, from a single connect.
 *
 * ═══ THE ORDER OF THE TWO WRITES ═══
 *
 * License row first, placeholder second. A crash in between leaves BOTH rows,
 * and both of them refuse the same person — untidy and safe. The other order
 * has a window in which nobody is banned at all.
 *
 * ═══ THE ONE DELETE IN A FILE WHOSE FIRST RULE IS "A BAN IS A RECORD" ═══
 *
 * The owner settled this too, and it does not contradict the rule as long as it
 * is read for what it says. The rule protects the answer to "has this person
 * been banned before, and who let them back in" — and that answer is not in the
 * placeholder. It is in the license row this function writes, which carries the
 * placeholder's `at`, `by`, `byName`, `reason` and `expiresAt` unchanged, plus
 * `reconciledFrom` naming the key it came from. Nothing is lost, so nothing is
 * being deleted in the sense the rule forbids: the row moves, it does not end.
 * The delete is conditional on the row being the one we read, so a ban issued
 * into the gap survives.
 *
 * `discordEntryId` TRAVELS WITH IT, and this is the subtle half. blitz-bot lifts
 * a game ban only when that attribute is present (`liftableBy`), and on an unban
 * it looks up BOTH the license — which by then the reverse index knows, because
 * the same connect that triggered us wrote it — and the `discord:` key. So a
 * later Discord unban finds the reconciled row and lifts it. Drop the marker and
 * the unban silently does nothing, forever.
 */
export async function reconcileDiscordBan(
  input: {
    /** The bare snowflake, as the game reports it. Qualified here. */
    discordId: string
    /** The license the same connection presented. */
    license: string
    now?: number
  },
  store: BanStore = liveBanStore,
): Promise<ReconcileOutcome> {
  const now = input.now ?? Date.now()
  const placeholderKey = `discord:${input.discordId}`

  const placeholder = await store.get(placeholderKey)
  if (!placeholder) return 'no-placeholder'

  /**
   * A LIFTED OR SERVED PLACEHOLDER IS LEFT EXACTLY WHERE IT IS. There is no
   * door to move, only a record — and moving a record onto a license would
   * write a ban row for somebody who is not banned, which reads on the
   * moderation list as a ban that was never issued. `isActive` decides, the
   * same way everything else here does.
   */
  if (!isActive(placeholder, now)) return 'not-active'

  const existing = await store.get(input.license)

  /**
   * THE LICENSE ALREADY CARRIES A BAN IN FORCE, so reconciliation waits.
   *
   * Overwriting it would replace a live ban — its reason, its issuer, its
   * expiry — with a different one, and there is no rule anywhere saying which
   * of two active bans is the better record. Deleting the placeholder and
   * keeping the license row instead would silently throw the Discord ban away:
   * if the license ban is temporary and the Discord one is permanent, the
   * person walks back in when the shorter one runs out.
   *
   * So: nothing moves, and NOTHING IS LOST. Both rows stay, the gate reads both
   * on every connect, and the next connect after the license ban is lifted or
   * served finds `existing` inactive and completes the move. Waiting costs one
   * `GetItem` per connect by somebody who is banned twice over.
   */
  if (existing && isActive(existing, now)) return 'deferred'

  const moved: Ban = {
    ...placeholder,
    license: input.license,
    reconciledFrom: placeholderKey,
    // A re-ban replaces the whole item, so a lifted `existing` must not leave
    // its lift fields behind on the row we are about to put in its place. Named
    // explicitly rather than trusted to the spread, because `placeholder` is an
    // active ban and may simply not carry these attributes at all.
    liftedAt: null,
    liftedBy: null,
    liftedByName: null,
    liftReason: null,
  }

  try {
    /**
     * "STILL WHAT WE READ." An admin issuing a ban from the console, or the bot
     * mirroring a second Discord ban, between our read and this write would
     * otherwise be overwritten by a decision made before theirs. `'absent'` is
     * the same guard for the other case: we read no row, so the row we are
     * guarding against is the one that appeared since.
     */
    await store.put(moved, existing ? { at: existing.at } : 'absent')
  } catch (e) {
    /**
     * ONLY THE CONDITION FAILING IS A `conflict`. A throttle, a missing table or
     * a lost route is a fault and has to leave the caller's journal saying so —
     * swallowing every error into "somebody else got there first" is how a
     * reconciliation that has never once succeeded looks exactly like a
     * reconciliation with nothing to do.
     */
    if (!isConditionFailure(e)) throw e
    return 'conflict'
  }

  try {
    // Guarded on the row we read, and not a newer ban that arrived on the same
    // Discord account since. Losing that one would be losing a ban outright,
    // because by now nothing else points at this key.
    await store.remove(placeholderKey, { at: placeholder.at })
  } catch (e) {
    /**
     * THE LICENSE ROW IS ALREADY WRITTEN, so this is not a failure to enforce
     * anything — it is a duplicate record left behind, and the next connect
     * tries the delete again. Reported as `conflict` so a caller does not log
     * "reconciled" over a placeholder that is still there.
     */
    if (!isConditionFailure(e)) throw e
    return 'conflict'
  }

  return 'reconciled'
}

/**
 * Did DynamoDB refuse this write because its condition did not hold?
 *
 * MATCHED ON `name`, WHICH IS WHERE THE SDK PUTS IT. v3 throws a typed error
 * whose `name` is the service exception; the older `code` spelling is gone. A
 * `catch {}` that could not tell this from a throttle was the alternative, and
 * it is the one that turns a broken deployment into a quiet no-op.
 */
function isConditionFailure(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { name?: string }).name === 'ConditionalCheckFailedException'
  )
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
