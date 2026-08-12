import { randomUUID } from 'node:crypto'

import { ddb, tables } from './dynamo'

/**
 * The audit trail.
 *
 * WRITTEN IN TWO PHASES, and that is the whole design. An action is recorded
 * BEFORE it is attempted and updated after it resolves, rather than written
 * once when it succeeds. Recording only successes produces a log that is
 * useless in exactly the moment it matters: the admin whose kick crashed the
 * resource, the ban that never reached the game host, the command issued
 * thirty seconds before the box went down. Those leave no trace at all in a
 * success-only log, and their absence looks identical to nobody having tried.
 *
 * So every action lands here first as `pending`, and the outcome is stamped on
 * afterwards. A row that stays `pending` forever is itself a finding — it means
 * we asked and never learned what happened, which is a different fact from
 * "it failed" and has to be distinguishable from it.
 *
 * THE GAME BOX NEVER READS THIS TABLE. Its IAM role has no access to it at
 * all, and that is deliberate rather than incidental: the audit log is the
 * record of what admins did, and a compromised game host should not be able to
 * read, still less rewrite, the account of its own compromise.
 */

/** What kind of thing happened. Open-ended by design — new verbs get added. */
export type AuditAction =
  | 'ban.issue'
  | 'ban.lift'
  | 'player.kick'
  | 'maintenance.schedule'
  | 'maintenance.cancel'
  | 'maintenance.drain'
  | 'maintenance.deploy'

export type AuditOutcome = 'pending' | 'ok' | 'failed'

export interface AuditRow {
  /**
   * Partition key. A single literal string, so the whole log is one partition
   * ordered by `ts` and "show me the last 50 actions" is one Query.
   *
   * FINE AT THIS SCALE AND NOT FOREVER: DynamoDB partitions cap at 1000 WCU,
   * and admin actions are measured in tens per day, so the ceiling is roughly
   * four orders of magnitude away. When it stops being fine the key becomes
   * `AUDIT#<yyyy-mm>` and the reader queries the current and previous month —
   * noted here because the migration is cheap now and expensive after somebody
   * writes a report that assumes one partition.
   */
  pk: string
  /** Sort key: milliseconds since epoch. */
  ts: number

  /** Joins the intent row to the outcome that arrives later. */
  commandId: string

  action: AuditAction
  outcome: AuditOutcome

  /** The acting admin. License is the identity every other table keys on. */
  actorLicense: string | null
  actorName: string
  actorDiscordId: string | null

  /** Who it was done to, when the action targets a player. */
  targetLicense?: string | null
  targetName?: string | null

  /** Free text supplied by the admin (a ban reason). Never interpolated. */
  reason?: string | null

  /** Set when the outcome lands. */
  resolvedAt?: number
  /** Why it failed, for the failed case. Operator-facing, not a stack trace. */
  error?: string | null

  /** Anything action-specific worth keeping. Small, and never secrets. */
  detail?: Record<string, string | number | boolean | null>
}

const PK = 'AUDIT'

export interface Actor {
  license: string | null
  name: string
  discordId: string | null
}

/** The handle to an open intent row: both halves of its primary key. */
export interface AuditHandle {
  /** Minted here, echoed back by the game side so the two halves join. */
  commandId: string
  /** The row's sort key. Returned rather than re-derived — see below. */
  ts: number
}

/**
 * Record the intent to do something. Returns the handle {@link resolve} needs.
 *
 * CALLED BEFORE THE ACTION, always. If this throws, the action must not
 * proceed — an unlogged admin action is precisely what this table exists to
 * make impossible, so a failure to record is a failure to act.
 *
 * IT RETURNS `ts` RATHER THAN LETTING THE CALLER STAMP ITS OWN. The sort key
 * is half the primary key, so a caller that called Date.now() separately would
 * update a row that does not exist — silently, because an UpdateItem against a
 * missing key creates one. That would leave the real intent row stuck at
 * `pending` forever and a second orphan row holding the outcome.
 */
export async function begin(input: {
  action: AuditAction
  actor: Actor
  targetLicense?: string | null
  targetName?: string | null
  reason?: string | null
  detail?: AuditRow['detail']
}): Promise<AuditHandle> {
  const commandId = randomUUID()
  const ts = Date.now()

  const row: AuditRow = {
    pk: PK,
    ts,
    commandId,
    action: input.action,
    outcome: 'pending',
    actorLicense: input.actor.license,
    actorName: input.actor.name,
    actorDiscordId: input.actor.discordId,
    targetLicense: input.targetLicense ?? null,
    targetName: input.targetName ?? null,
    reason: input.reason ?? null,
    detail: input.detail,
  }

  await ddb.put({ TableName: tables.audit, Item: row })
  return { commandId, ts }
}

/**
 * Stamp the outcome onto an intent row.
 *
 * Takes the row's own `ts` because that is half the primary key — the caller
 * holds it from {@link begin}'s return trip. A conditional update would be
 * tidier but needs a GSI on commandId to find the row by id alone, which is
 * not worth a whole index for a value we already have in hand.
 *
 * NEVER THROWS. A failure to record the outcome must not turn a successful
 * ban into an error the admin sees and retries — the ban happened, and a row
 * stuck at `pending` is the honest record of a bookkeeping failure. It is
 * logged for the operator and swallowed for the caller.
 */
export async function resolve(
  ts: number,
  outcome: Exclude<AuditOutcome, 'pending'>,
  error?: string | null,
): Promise<void> {
  try {
    await ddb.update({
      TableName: tables.audit,
      Key: { pk: PK, ts },
      UpdateExpression:
        'SET outcome = :o, resolvedAt = :r, #e = :e',
      ExpressionAttributeNames: { '#e': 'error' },
      ExpressionAttributeValues: {
        ':o': outcome,
        ':r': Date.now(),
        ':e': error ?? null,
      },
    })
  } catch (e) {
    console.error('[audit] failed to record outcome', { ts, outcome, e })
  }
}

/**
 * A convenience wrapper: record the intent, run the action, stamp the result.
 *
 * Returns whatever the action returned. Rethrows what the action threw, after
 * recording the failure — the caller still gets to decide what the admin sees.
 */
export async function audited<T>(
  input: Parameters<typeof begin>[0],
  run: (commandId: string) => Promise<T>,
): Promise<T> {
  const { commandId, ts } = await begin(input)

  try {
    const out = await run(commandId)
    await resolve(ts, 'ok')
    return out
  } catch (e) {
    await resolve(ts, 'failed', e instanceof Error ? e.message : String(e))
    throw e
  }
}

/**
 * The most recent actions, newest first.
 *
 * `ScanIndexForward: false` walks the sort key backwards, which is how you get
 * "latest" out of DynamoDB without sorting client-side.
 */
export async function recent(limit = 100): Promise<AuditRow[]> {
  const res = await ddb.query({
    TableName: tables.audit,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': PK },
    ScanIndexForward: false,
    Limit: limit,
  })

  return (res.Items ?? []) as AuditRow[]
}
